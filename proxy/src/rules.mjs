/**
 * Чистые правила: маски сайта, поиск сайта по URL и разрешение локального файла.
 * Без chrome.* и без побочных эффектов — используется и прокси, и PAC, и интерфейс.
 */
import fs from 'node:fs';
import path from 'node:path';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** glob → фрагмент регекспа. '*' в хосте не пересекает '/', в пути — пересекает. */
export function urlGlobToRegex(glob) {
  const g = String(glob).trim();
  let auth = g;
  let rest = '';
  const schemeEnd = g.indexOf('://');
  if (schemeEnd >= 0) {
    const afterScheme = schemeEnd + 3;
    const slash = g.indexOf('/', afterScheme);
    if (slash >= 0) {
      auth = g.slice(0, slash);
      rest = g.slice(slash);
    }
  }
  const conv = (s, star) => escapeRe(s).replace(/\\\*/g, star).replace(/\\\?/g, '.');
  return conv(auth, '[^/]*') + conv(rest, '.*');
}

/** Порядок важнее длины: маска → префикс-окружение-сайт. */
export function sitePatterns(site) {
  const out = [];
  if (site && site.mask && Array.isArray(site.mask.prefixes) && Array.isArray(site.mask.hosts)) {
    const envs =
      Array.isArray(site.mask.envs) && site.mask.envs.length ? site.mask.envs : [{ value: '', enabled: true }];
    for (const p of site.mask.prefixes) {
      if (!p || p.enabled === false || !p.value) continue;
      for (const e of envs) {
        if (!e || e.enabled === false) continue;
        for (const h of site.mask.hosts) {
          if (!h || h.enabled === false || !h.value) continue;
          const host = p.value === 'отсутствует' ? `${e.value}.${h.value}` : `${p.value}-${e.value}.${h.value}`;
          out.push(`https://${host}`);
        }
      }
    }
  }
  if (Array.isArray(site && site.match)) out.push(...site.match.filter(Boolean));
  else if (site && typeof site.match === 'string' && site.match) out.push(site.match);
  if (site && site.url) out.push(site.url);
  return [...new Set(out.map((s) => String(s).trim()).filter(Boolean))];
}

export function effectivePatterns(site) {
  if (site && Array.isArray(site.patterns) && site.patterns.length) return site.patterns;
  return sitePatterns(site);
}

/**
 * Хост-часть шаблона (без схемы и порта) в нижнем регистре или null, если по шаблону
 * нельзя судить о хосте (`<all_urls>`, шаблон без схемы).
 */
export function hostOfPattern(pattern) {
  const p = String(pattern).trim();
  const at = p.indexOf('://');
  if (at < 0) return null;
  const auth = p.slice(at + 3).split('/')[0];
  const host = auth.replace(/:(\d+|\*)$/, '').toLowerCase();
  return host || null;
}

/** Регексп «URL относится к сайту» (любой путь). В Node лимиты RE2 не мешают. */
export function buildSiteRegex(site) {
  const patterns = effectivePatterns(site);
  if (!patterns.length) return null;
  const parts = patterns.map((p) => {
    const hasPath = /^[a-z*]+:\/\/[^/]+\//i.test(p);
    return urlGlobToRegex(p) + (hasPath ? '' : '(?:/.*)?');
  });
  try {
    return new RegExp(`^(?:${parts.join('|')})$`, 'i');
  } catch {
    return null;
  }
}

/** Шаблон хоста (`*` — любые символы) → регексп. */
const hostGlobToRegex = (glob) => new RegExp(`^${escapeRe(glob).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')}$`, 'i');

/**
 * Скомпилированные правила конфига. Кэш хранится на самом конфиге и сбрасывается
 * через `touchConfig`, поэтому правка маски действует сразу, без перезапуска.
 */
export function touchConfig(config) {
  config.__version = (config.__version || 0) + 1;
  delete config.__compiled;
}

export function compile(config) {
  if (config.__compiled) return config.__compiled;
  const sites = [];
  const hostGlobs = new Set();
  let anyHost = false;
  for (const site of config.sites || []) {
    if (!site || site.enabled === false) continue;
    const re = buildSiteRegex(site);
    if (!re) continue;
    const patterns = effectivePatterns(site);
    sites.push({ site, re, weight: patterns.join('|').length });
    for (const p of patterns) {
      const h = hostOfPattern(p);
      if (h === null) anyHost = true;
      else hostGlobs.add(h);
    }
  }
  const hostRes = [...hostGlobs].map(hostGlobToRegex);
  const hostCache = new Map();
  const compiled = {
    sites,
    /** список хостов-шаблонов для PAC; null — перехватывать нужно всё */
    hostGlobs: anyHost ? null : [...hostGlobs].sort(),
    matchHost(host) {
      const h = String(host || '').toLowerCase();
      if (!sites.length) return false;
      if (anyHost) return true;
      const cached = hostCache.get(h);
      if (cached !== undefined) return cached;
      const hit = hostRes.some((re) => re.test(h));
      if (hostCache.size > 5000) hostCache.clear();
      hostCache.set(h, hit);
      return hit;
    },
  };
  config.__compiled = compiled;
  return compiled;
}

export function pickSite(config, absUrl) {
  let best = null;
  let bestWeight = -1;
  for (const entry of compile(config).sites) {
    if (entry.weight > bestWeight && entry.re.test(absUrl)) {
      best = entry.site;
      bestWeight = entry.weight;
    }
  }
  return best;
}

/** Хост подпадает под маски хотя бы одного включённого сайта? */
export function hostMatches(config, host) {
  return compile(config).matchHost(host);
}

/**
 * Служебные префиксы URL, которые не входят в локальный путь.
 * Задаются в конфиге (`servicePrefixes`), потому что это особенность конкретного
 * сайта, а не общее правило. По умолчанию список пуст — путь берётся как есть.
 */
export const DEFAULT_SERVICE_PREFIXES = [];

export function stripServicePrefixes(rel, prefixes = DEFAULT_SERVICE_PREFIXES) {
  const clean = String(rel || '').replace(/^\/+/, '');
  for (const prefix of prefixes || []) {
    const p = String(prefix || '').replace(/^\/+|\/+$/g, '');
    if (!p) continue;
    if (clean === p) return { rel: clean, cut: '' };
    if (clean.startsWith(p + '/')) return { rel: clean.slice(p.length + 1), cut: p };
  }
  return { rel: clean, cut: '' };
}

/** Путь запроса без ведущих слэшей; битая %-последовательность → null. */
export function relForSite(site, target) {
  try {
    const rel = decodeURIComponent(target.pathname).replace(/^\/+/, '');
    return rel.includes('\0') ? null : rel;
  } catch {
    return null;
  }
}

/**
 * Расширения, которые разрешено подменять (поле «Файлы» в маске): множество в нижнем регистре
 * или null, если фильтра нет (список не задан или пуст).
 */
export function allowedExtensions(site) {
  const list = site && Array.isArray(site.files) ? site.files : null;
  if (!list || !list.length) return null;
  return new Set(
    list
      .filter((f) => f && f.enabled !== false && f.value)
      .map((f) => String(f.value).trim().replace(/^\./, '').toLowerCase()),
  );
}

/** Варианты имени без «.min» и с ним. */
export function minVariants(rel) {
  const out = [];
  if (/\.min\.(js|css|tmpl|html)$/i.test(rel)) out.push(rel.replace(/\.min(\.(?:js|css|tmpl|html))$/i, '$1'));
  else if (/\.(js|css|tmpl|html)$/i.test(rel)) out.push(rel.replace(/\.(js|css|tmpl|html)$/i, '.min.$1'));
  return out;
}

export function rootsForSite(config, site) {
  // roots бывают и строками ("F:\\test"), и объектами {abs|path}.
  const global = (config.roots || [])
    .filter((r) => (r && typeof r !== 'object' ? true : r && r.enabled !== false))
    .map((r) => (typeof r === 'string' ? r : String((r && (r.abs || r.path)) || '')))
    .filter(Boolean);
  if (global.length) return global;
  const single = site && site.root ? String(site.root) : '';
  return single ? [single] : [];
}

/** Файловые проверки; прокси подставляет кэширующую реализацию. */
export const syncFs = {
  isFile(p) {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  },
  exists(p) {
    return fs.existsSync(p);
  },
};

export function pickRootForModule(config, roots, moduleName, fsx = syncFs) {
  if (!roots.length) return { root: null, via: 'нет рутов' };
  const explicit = moduleName ? (config.moduleRoots || {})[moduleName] : null;
  if (explicit) {
    const target = String(explicit).toLowerCase();
    const hit = roots.find((r) => r.toLowerCase() === target);
    if (hit) return { root: hit, via: 'выбран пользователем' };
  }
  if (moduleName) {
    const withModule = roots.find((r) => fsx.exists(path.join(r, moduleName)));
    if (withModule) return { root: withModule, via: 'первый рут с модулем' };
  }
  return { root: roots[0], via: 'первый рут' };
}

export function insideRoot(root, file) {
  const r = path.resolve(root);
  const f = path.resolve(file);
  return f === r || f.startsWith(r + path.sep) ? f : null;
}

/**
 * Что отдать на этот URL: локальный файл или серверный.
 * Возвращает { file } | { missing } | { passthrough, reason }.
 */
export function resolveLocal(config, site, target, fsx = syncFs) {
  if (site.useLocal === false) return { passthrough: true, reason: 'локальный путь отключён' };

  const roots = rootsForSite(config, site);
  if (!roots.length) return { passthrough: true, reason: 'нет папок с кодом' };
  const relRaw = relForSite(site, target);
  if (relRaw === null) return { passthrough: true, reason: 'некорректный путь' };

  const rel = stripServicePrefixes(relRaw, config.servicePrefixes).rel;
  const moduleName = rel.split('/')[0] || '';

  // подменяются только файлы с выбранными расширениями
  const allowed = allowedExtensions(site);
  if (allowed) {
    const ext = path.extname(rel).slice(1).toLowerCase();
    if (!allowed.has(ext)) return { passthrough: true, reason: 'расширение не выбрано', moduleName };
  }

  // подменяем только выбранные модули
  if (moduleName && !(config.moduleRoots || {})[moduleName]) {
    return { passthrough: true, reason: 'модуль не выбран', moduleName };
  }

  const { root: active } = pickRootForModule(config, roots, moduleName, fsx);
  const order = [active, ...roots.filter((r) => r !== active)].filter(Boolean);
  for (const root of order) {
    const file = insideRoot(root, path.join(root, rel));
    if (!file) continue;
    if (fsx.isFile(file)) return { file, via: root === active ? 'mirror' : 'mirror-other', root, moduleName };
    for (const alt of minVariants(rel)) {
      const altFile = insideRoot(root, path.join(root, alt));
      if (altFile && fsx.isFile(altFile)) {
        return { file: altFile, via: root === active ? 'mirror-min' : 'mirror-other-min', root, moduleName };
      }
    }
  }
  return { missing: path.join(active || '', rel), root: active, moduleName };
}
