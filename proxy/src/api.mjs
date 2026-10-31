/**
 * API интерфейса. Не привязано к HTTP: `api.handle()` принимает метод, путь и тело,
 * а оболочка (Electron-протокол app:// или отладочный HTTP-сервер) только доставляет вызовы.
 * На порту прокси API не выставляется. Отдельный control.mjs публикует его на loopback с токеном.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { buildRoots, buildModules, firstSite } from './scan.mjs';
import { touchConfig, pickSite, resolveLocal } from './rules.mjs';
import { normalizeConfig, saveConfig } from './config.mjs';
import { parseProxy } from './upstream.mjs';

const ok = (json = {}) => ({ status: 200, json: { ok: true, ...json } });
const fail = (message, status = 200, extra = {}) => ({
  status,
  json: { ok: false, error: message, message, ...extra },
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Хост-имя без порта из заголовка Host. */
export const hostnameOf = (host) =>
  String(host || '')
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '');

export function makeApi(engine) {
  const { config, proxy, ca, platform } = engine;
  let writes = Promise.resolve();
  const publicConfig = () => Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith('__')));
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safeModule = (name) =>
    typeof name === 'string' &&
    !!name &&
    !/[\\/\0]/.test(name) &&
    !['.', '..', '__proto__', 'constructor', 'prototype'].includes(name);
  const optionList = (list) =>
    Array.isArray(list) &&
    list.every((v) => object(v) && typeof v.value === 'string' && typeof v.enabled === 'boolean');

  function validateConfig(src) {
    if (!object(src)) return 'ожидается объект config';
    for (const key of Object.keys(src)) {
      if (!['sites', 'roots', 'moduleRoots', 'servicePrefixes', 'upstreamProxy', 'liveReload', 'theme'].includes(key))
        return 'неизвестная или неизменяемая настройка: ' + key;
    }
    if (
      'roots' in src &&
      (!Array.isArray(src.roots) ||
        !src.roots.every((r) =>
          typeof r === 'string'
            ? path.isAbsolute(r)
            : object(r) &&
              typeof (r.path || r.abs) === 'string' &&
              path.isAbsolute(r.path || r.abs) &&
              (r.enabled === undefined || typeof r.enabled === 'boolean'),
        ))
    )
      return 'roots: ожидаются абсолютные пути или объекты {path, enabled}';
    if (
      'moduleRoots' in src &&
      (!object(src.moduleRoots) ||
        !Object.entries(src.moduleRoots).every(
          ([name, root]) => safeModule(name) && typeof root === 'string' && path.isAbsolute(root),
        ))
    )
      return 'moduleRoots: ожидаются имена модулей и абсолютные пути';
    if (
      'servicePrefixes' in src &&
      (!Array.isArray(src.servicePrefixes) || !src.servicePrefixes.every((v) => typeof v === 'string'))
    )
      return 'servicePrefixes: ожидается массив строк';
    if ('liveReload' in src && typeof src.liveReload !== 'boolean') return 'liveReload: ожидается boolean';
    if ('theme' in src && !['auto', 'light', 'dark'].includes(src.theme)) return 'theme: auto, light или dark';
    if (
      'upstreamProxy' in src &&
      (typeof src.upstreamProxy !== 'string' || (src.upstreamProxy.trim() && !parseProxy(src.upstreamProxy)))
    )
      return 'upstreamProxy: ожидается host:port или пустая строка';
    if ('sites' in src) {
      if (!Array.isArray(src.sites)) return 'sites: ожидается массив';
      for (const site of src.sites) {
        if (!object(site)) return 'sites: ожидаются объекты сайтов';
        if (['enabled', 'useLocal'].some((key) => key in site && typeof site[key] !== 'boolean'))
          return 'sites: enabled/useLocal должны быть boolean';
        if (
          'match' in site &&
          !(
            typeof site.match === 'string' ||
            (Array.isArray(site.match) && site.match.every((s) => typeof s === 'string'))
          )
        )
          return 'sites.match: ожидаются строки';
        if ('patterns' in site && (!Array.isArray(site.patterns) || !site.patterns.every((s) => typeof s === 'string')))
          return 'sites.patterns: ожидаются строки';
        if ('files' in site && !optionList(site.files)) return 'sites.files: ожидается массив {value, enabled}';
        if (
          'mask' in site &&
          (!object(site.mask) || !['prefixes', 'envs', 'hosts'].every((key) => optionList(site.mask[key])))
        )
          return 'sites.mask: ожидаются prefixes, envs, hosts';
      }
    }
    return '';
  }

  async function commitConfig(patch) {
    const error = validateConfig(patch);
    if (error) return fail(error, 400);
    const next = normalizeConfig({ ...publicConfig(), ...patch });
    next.__path = config.__path;
    // При ошибке записи действующий конфиг остаётся целым и в памяти, и на диске.
    saveConfig(next);
    Object.assign(config, Object.fromEntries(Object.entries(next).filter(([key]) => !key.startsWith('__'))));
    touchConfig(config);
    try {
      await engine.configChanged();
    } catch (error) {
      return fail('правила сохранены, но системный PAC не обновлён: ' + error.message, 500, { configSaved: true });
    }
    return ok();
  }

  /** Статика собранного интерфейса (режим без Electron). */
  function serveStatic(pathname) {
    const dist = engine.distDir;
    if (!dist || !fs.existsSync(dist))
      return {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: 'интерфейс не собран: npm run build:ui',
      };
    let rel;
    try {
      rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return { status: 400, headers: {}, body: '' };
    }
    const root = path.resolve(dist);
    const abs = path.resolve(root, rel);
    const inside = abs === root || abs.startsWith(root + path.sep);
    const file = inside && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(root, 'index.html');
    return {
      status: 200,
      headers: {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      },
      body: fs.readFileSync(file),
    };
  }

  async function state() {
    const [sys, trusted] = await Promise.all([engine.reconcileProxy(), engine.certTrusted()]);
    const roots = buildRoots(config);
    const site = firstSite(config);
    const ours = engine.ownsSystemPac(sys);
    return {
      ok: true,
      version: engine.version,
      platform: platform.id,
      enabled: proxy.state.enabled,
      routeMode: engine.routeMode,
      configPath: config.__path,
      config: publicConfig(),
      sites: config.sites,
      roots,
      modules: buildModules(config, roots),
      moduleRoots: config.moduleRoots,
      mask: (site && site.mask) || { prefixes: [], envs: [], hosts: [], extra: [] },
      files: (site && site.files) || [
        { value: 'js', enabled: true },
        { value: 'css', enabled: true },
      ],
      port: engine.port,
      pacUrl: engine.pacUrl(),
      hosts: engine.hostGlobs(),
      upstream: engine.effectiveUpstream(),
      liveReload: config.liveReload === true,
      stats: proxy.stats(),
      cert: {
        trusted,
        thumbprint: engine.thumbprint,
        certPath: ca.certPath,
        created: ca.created,
        constraints: engine.caConstraints(),
      },
      systemProxy: {
        enabled: ours,
        ours,
        pacUrl: sys.pacUrl,
        server: sys.manual.enabled ? sys.manual.server : '',
        override: '',
        overridden: ours && (await engine.proxyOverridden()),
      },
    };
  }

  async function open(target) {
    if (engine.hooks.openPath) return engine.hooks.openPath(target);
    if (!fs.existsSync(target)) return 'нет такой папки';
    const [cmd, args] = process.platform === 'darwin' ? ['open', [target]] : ['explorer.exe', [target]];
    execFile(cmd, args, () => {});
    return '';
  }

  /** Обработать вызов API. Возвращает { status, json } | { status, headers, body } | { status, sse }. */
  async function handle(method, rawUrl, body = {}) {
    const url = new URL(rawUrl, 'http://app.invalid');
    const route = url.pathname;
    method = String(method || 'GET').toUpperCase();

    if (!route.startsWith('/api/')) {
      if (method === 'GET' || method === 'HEAD') return serveStatic(route);
      return { status: 405, headers: {}, body: '' };
    }

    switch (`${method} ${route}`) {
      case 'GET /api/state':
        return { status: 200, json: await state() };

      case 'GET /api/capabilities':
        return ok({
          apiVersion: 1,
          transport: 'loopback-bearer',
          desktop: {
            window: !!engine.hooks.window,
            updates: !!engine.hooks.update,
            folderPicker: !!engine.hooks.pickFolder,
          },
          routes: {
            GET: ['state', 'config', 'capabilities', 'log?n=200', 'events', 'resolve?url=URL', 'cert/file', 'update'],
            POST: [
              'enabled',
              'config',
              'site',
              'roots',
              'module-root',
              'log/clear',
              'proxy/on',
              'proxy/off',
              'browser/open',
              'cert/install',
              'cert/uninstall',
              'cert/reset',
              'open',
              'open-settings',
              'pick-folder',
              'window',
              'update/check',
              'update/download',
              'update/install',
              'quit',
            ],
          },
        });

      case 'GET /api/log':
        return ok({
          log: proxy.logs.slice(0, Math.max(0, Math.min(Number(url.searchParams.get('n') ?? 200) || 0, 500))),
        });

      case 'POST /api/log/clear':
        proxy.clearLog();
        engine.events.emit('log-clear');
        return ok();

      case 'POST /api/enabled':
        if (typeof body.enabled !== 'boolean') return fail('enabled: ожидается boolean', 400);
        return ok({ enabled: await engine.setEnabled(body.enabled) });

      case 'GET /api/config':
        return ok({ config: publicConfig() });

      case 'POST /api/config': {
        return commitConfig(Object.hasOwn(body, 'config') ? body.config : body);
      }

      case 'POST /api/site': {
        const index = body.id !== undefined ? config.sites.findIndex((s) => s.id === body.id) : (body.index ?? 0);
        if (!Number.isInteger(index) || index < 0 || index >= config.sites.length || !object(body.patch))
          return fail('неизвестный сайт или некорректный patch', 400);
        const sites = config.sites.map((site, i) => (i === index ? { ...site, ...body.patch } : site));
        return commitConfig({ sites });
      }

      case 'POST /api/roots': {
        const pathOf = (r) => (typeof r === 'string' ? r : r.path || r.abs);
        const same = (a, b) =>
          platform.id === 'win32'
            ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
            : path.resolve(a) === path.resolve(b);
        let roots = [...config.roots];
        const moduleRoots = { ...config.moduleRoots };
        if (
          !['add', 'remove', 'replace'].includes(body.action) ||
          typeof body.path !== 'string' ||
          !path.isAbsolute(body.path)
        )
          return fail('ожидаются action и абсолютный path', 400);
        if (body.action === 'add') {
          if (!roots.some((r) => same(pathOf(r), body.path))) roots.push(body.path);
        } else {
          if (!roots.some((r) => same(pathOf(r), body.path))) return fail('папка не найдена', 404);
          if (body.action === 'replace' && (typeof body.replacement !== 'string' || !path.isAbsolute(body.replacement)))
            return fail('replacement: ожидается абсолютный путь', 400);
          if (
            body.action === 'replace' &&
            roots.some((r) => !same(pathOf(r), body.path) && same(pathOf(r), body.replacement))
          )
            return fail('такая папка уже добавлена', 409);
          roots = roots.flatMap((r) =>
            !same(pathOf(r), body.path)
              ? [r]
              : body.action === 'remove'
                ? []
                : [typeof r === 'string' ? body.replacement : { ...r, abs: undefined, path: body.replacement }],
          );
          for (const [name, root] of Object.entries(moduleRoots)) {
            if (!same(root, body.path)) continue;
            if (body.action === 'remove') delete moduleRoots[name];
            else moduleRoots[name] = body.replacement;
          }
        }
        return commitConfig({ roots, moduleRoots });
      }

      case 'POST /api/module-root': {
        const module = String(body.module || '');
        if (!safeModule(module)) return fail('некорректное имя модуля', 400);
        const moduleRoots = { ...config.moduleRoots };
        if (body.root) {
          if (typeof body.root !== 'string' || !engine.rootPaths().includes(body.root))
            return fail('root должен быть включённой папкой из roots', 400);
          moduleRoots[module] = body.root;
        } else delete moduleRoots[module];
        return commitConfig({ moduleRoots });
      }

      case 'POST /api/pick-folder': {
        if (!engine.hooks.pickFolder) return fail('выбор папки доступен только в приложении');
        const picked = await engine.hooks.pickFolder(String(body.title || 'Выберите папку с кодом'));
        return picked ? ok({ path: picked }) : fail('отменено');
      }

      case 'POST /api/open': {
        const target = String(body.path || body.root || '');
        if (!target) return fail('не указан путь', 400);
        const err = await open(target);
        return err ? fail(err) : ok();
      }

      case 'POST /api/open-settings':
        await platform.openProxySettings();
        return ok();

      case 'POST /api/quit':
        setTimeout(() => (engine.hooks.quit ? engine.hooks.quit() : process.exit(0)), 100);
        return ok();

      case 'POST /api/cert/install': {
        const r = await platform.certInstall({ pem: ca.certPem, file: ca.certPath });
        engine.invalidateTrust();
        const trusted = await engine.certTrusted(0);
        engine.events.emit('state');
        return {
          status: 200,
          json: { ok: !!r.ok && trusted, trusted, error: r.ok ? undefined : r.error, manual: r.manual },
        };
      }

      case 'POST /api/cert/uninstall': {
        await engine.setEnabled(false);
        const r = await platform.certUninstall({ pem: ca.certPem, file: ca.certPath });
        engine.invalidateTrust();
        engine.events.emit('state');
        return { status: 200, json: { ok: !!r.ok, trusted: await engine.certTrusted(0) } };
      }

      case 'POST /api/cert/reset': {
        // сертификат и ключ удаляются; новый корень появится при следующем запуске
        await engine.setEnabled(false);
        await engine.resetCA();
        setTimeout(() => (engine.hooks.quit ? engine.hooks.quit() : process.exit(0)), 300);
        return ok({ restart: true });
      }

      case 'GET /api/cert/file':
        return {
          status: 200,
          headers: {
            'content-type': 'application/x-x509-ca-cert',
            'content-disposition': 'attachment; filename="BodySnatch Desktop Root CA.crt"',
          },
          body: fs.readFileSync(ca.certPath),
        };

      case 'POST /api/proxy/on':
        try {
          await engine.setEnabled(true);
          return ok({ systemProxy: (await state()).systemProxy });
        } catch (e) {
          return fail(String((e && e.message) || e), 200, { manual: true, address: engine.pacUrl() });
        }

      case 'POST /api/browser/open': {
        // в браузере без подмены открывать нечего: включаем её вместе с запуском
        const r = await engine.launchBrowser();
        engine.events.emit('state');
        return r.ok ? ok({ browser: r.browser }) : fail(r.error);
      }

      case 'POST /api/proxy/off':
        try {
          await engine.setEnabled(false);
          return ok({ systemProxy: (await state()).systemProxy });
        } catch (e) {
          return fail(String((e && e.message) || e));
        }

      case 'GET /api/resolve': {
        let target;
        try {
          target = new URL(url.searchParams.get('url'));
        } catch {
          return fail('некорректный URL', 400);
        }
        if (!['http:', 'https:'].includes(target.protocol)) return fail('ожидается HTTP(S) URL', 400);
        const site = pickSite(config, target.href);
        return ok({
          enabled: proxy.state.enabled,
          site: site?.id ?? null,
          result: site
            ? resolveLocal(config, site, target, engine.files)
            : { passthrough: true, reason: 'сайт не выбран' },
        });
      }

      case 'GET /api/update':
      case 'POST /api/update/check':
      case 'POST /api/update/download':
      case 'POST /api/update/install': {
        if (!engine.hooks.update) return fail('обновления доступны только в Electron', 501);
        const action = method === 'GET' ? 'state' : route.split('/').at(-1);
        if (action === 'install' || action === 'download') {
          const before = await engine.hooks.update('state');
          if (action === 'install' && before.status !== 'ready')
            return fail('установщик ещё не готов', 409, { update: before });
          if (action === 'download' && !['available', 'error'].includes(before.status))
            return fail('нет доступной загрузки', 409, { update: before });
        }
        const update = await engine.hooks.update(action);
        if (action === 'install' && update.status === 'error') return fail(update.error, 409, { update });
        return ok({ update });
      }

      case 'POST /api/window':
        if (!['show', 'hide', 'minimize'].includes(body.action)) return fail('action: show, hide, minimize', 400);
        if (!engine.hooks.window) return fail('окно доступно только в Electron', 501);
        await engine.hooks.window(body.action);
        return ok();

      case 'GET /api/events':
        return {
          status: 200,
          sse: (send) => {
            const onLog = (entry) => send('log', entry);
            const onState = () => send('state', {});
            const onFiles = (names) => send('files', names);
            const onClear = () => send('log-clear', {});
            engine.events.on('log', onLog);
            engine.events.on('state', onState);
            engine.events.on('files', onFiles);
            engine.events.on('log-clear', onClear);
            return () => {
              engine.events.off('log', onLog);
              engine.events.off('state', onState);
              engine.events.off('files', onFiles);
              engine.events.off('log-clear', onClear);
            };
          },
        };

      default:
        return fail('неизвестный маршрут ' + route, 404);
    }
  }

  return {
    drain: () => writes,
    handle(method, url, body = {}) {
      if (!object(body)) return Promise.resolve(fail('ожидается JSON-объект', 400));
      if (String(method).toUpperCase() !== 'POST') return handle(method, url, body);
      const result = writes.then(() => handle(method, url, body));
      writes = result.catch(() => {});
      return result;
    },
    serveStatic,
  };
}
