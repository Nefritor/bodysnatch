/**
 * Чистые правила: маски сайта, поиск сайта по URL и разрешение локального файла.
 * Логика повторяет агент расширения (bodysnatcher/agent/agent.mjs), но без chrome.*,
 * чтобы её можно было использовать в MITM-прокси.
 */

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

const pageRegexCache = new Map();
export function pageRegex(site) {
  const key = site.id || effectivePatterns(site).join('|');
  if (pageRegexCache.has(key)) return pageRegexCache.get(key);
  const re = buildSiteRegex(site);
  pageRegexCache.set(key, re);
  return re;
}

export function pickSite(config, absUrl) {
  let best = null;
  let bestLen = -1;
  for (const site of config.sites || []) {
    if (site.enabled === false) continue;
    const re = pageRegex(site);
    if (!re || !re.test(absUrl)) continue;
    const len = effectivePatterns(site).join('|').length;
    if (len > bestLen) {
      best = site;
      bestLen = len;
    }
  }
  return best;
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

export function relForSite(site, target) {
  return decodeURIComponent(target.pathname).replace(/^\/+/, '');
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

export function pickRootForModule(config, roots, moduleName) {
  if (!roots.length) return { root: null, via: 'нет рутов' };
  const explicit = moduleName ? (config.moduleRoots || {})[moduleName] : null;
  if (explicit) {
    const target = String(explicit).toLowerCase();
    const hit = roots.find((r) => r.toLowerCase() === target);
    if (hit) return { root: hit, via: 'выбран пользователем' };
  }
  if (moduleName) {
    const withModule = roots.find((r) => {
      try {
        return fsExistsSync(joinPath(r, moduleName));
      } catch {
        return false;
      }
    });
    if (withModule) return { root: withModule, via: 'первый рут с модулем' };
  }
  return { root: roots[0], via: 'первый рут' };
}

// ленивый fs, чтобы модуль оставался тестируемым без побочек
import fs from 'node:fs';
import path from 'node:path';

const fsExistsSync = (p) => fs.existsSync(p);
const joinPath = (...p) => path.join(...p);

export function insideRoot(root, file) {
  const r = path.resolve(root);
  const f = path.resolve(file);
  return f === r || f.startsWith(r + path.sep) ? f : null;
}

/**
 * Что отдать на этот URL: локальный файл или серверный.
 * Возвращает { file } | { missing } | { passthrough, reason }.
 */
export function resolveLocal(config, site, target) {
  if (site.useLocal === false) return { passthrough: true, reason: 'локальный путь отключён' };

  const roots = rootsForSite(config, site);
  if (!roots.length) return { passthrough: true, reason: 'нет папок с кодом' };
  const relRaw = relForSite(site, target);

  const trimmed = stripServicePrefixes(relRaw, config.servicePrefixes);
  const rel = trimmed.rel;
  const moduleName = rel.split('/')[0] || '';

  // подменяем только выбранные модули
  if (moduleName && !(config.moduleRoots || {})[moduleName]) {
    return { passthrough: true, reason: 'модуль не выбран', moduleName };
  }

  const { root: active, via } = pickRootForModule(config, roots, moduleName);
  const order = [active, ...roots.filter((r) => r !== active)].filter(Boolean);
  for (const root of order) {
    const file = insideRoot(root, path.join(root, rel));
    if (!file) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return { file, via: root === active ? 'mirror' : 'mirror-other', root, moduleName };
    }
    for (const alt of minVariants(rel)) {
      const altFile = insideRoot(root, path.join(root, alt));
      if (!altFile) continue;
      if (fs.existsSync(altFile) && fs.statSync(altFile).isFile()) {
        return { file: altFile, via: root === active ? 'mirror-min' : 'mirror-other-min', root, moduleName };
      }
    }
  }
  return { missing: path.join(active || '', rel), root: active, moduleName };
}
