/**
 * API интерфейса. Не привязано к HTTP: `api.handle()` принимает метод, путь и тело,
 * а оболочка (Electron-протокол app:// или отладочный HTTP-сервер) только доставляет вызовы.
 * Наружу, на порт прокси, API не выставляется.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { buildRoots, buildModules, firstSite } from './scan.mjs';
import { touchConfig } from './rules.mjs';

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
    const [sys, trusted] = await Promise.all([engine.systemState(), engine.certTrusted()]);
    const roots = buildRoots(config);
    const site = firstSite(config);
    const ours = engine.isOurPac(sys.pacUrl);
    return {
      ok: true,
      version: engine.version,
      platform: platform.id,
      enabled: proxy.state.enabled,
      configPath: config.__path,
      config: {
        sites: config.sites,
        roots: config.roots,
        moduleRoots: config.moduleRoots,
        servicePrefixes: config.servicePrefixes,
        upstreamProxy: config.upstreamProxy,
        liveReload: config.liveReload,
      },
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

      case 'GET /api/log':
        return ok({ log: proxy.logs.slice(0, Math.min(Number(url.searchParams.get('n')) || 200, 500)) });

      case 'POST /api/log/clear':
        proxy.clearLog();
        return ok();

      case 'POST /api/enabled':
        return ok({ enabled: proxy.setEnabled(!!body.enabled) });

      case 'GET /api/config':
        return ok({ config: { sites: config.sites, roots: config.roots, moduleRoots: config.moduleRoots } });

      case 'POST /api/config': {
        const src = body && body.config && typeof body.config === 'object' ? body.config : body;
        if (Array.isArray(src.sites)) config.sites = src.sites;
        if (Array.isArray(src.roots)) config.roots = src.roots;
        if (src.moduleRoots && typeof src.moduleRoots === 'object') config.moduleRoots = src.moduleRoots;
        if (Array.isArray(src.servicePrefixes)) config.servicePrefixes = src.servicePrefixes;
        if (typeof src.upstreamProxy === 'string') config.upstreamProxy = src.upstreamProxy.trim();
        if (typeof src.liveReload === 'boolean') config.liveReload = src.liveReload;
        touchConfig(config);
        engine.saveConfig();
        await engine.configChanged();
        return ok();
      }

      case 'POST /api/module-root': {
        const module = String(body.module || '');
        if (!module) return fail('не указан модуль', 400);
        if (body.root) config.moduleRoots[module] = String(body.root);
        else delete config.moduleRoots[module];
        touchConfig(config);
        engine.saveConfig();
        engine.events.emit('state');
        return ok();
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
        const r = await platform.certUninstall({ pem: ca.certPem, file: ca.certPath });
        engine.invalidateTrust();
        engine.events.emit('state');
        return { status: 200, json: { ok: !!r.ok, trusted: await engine.certTrusted(0) } };
      }

      case 'POST /api/cert/reset': {
        // сертификат и ключ удаляются; новый корень появится при следующем запуске
        await engine.disableSystemProxy().catch(() => {});
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
          await engine.enableSystemProxy();
          return ok({ systemProxy: (await state()).systemProxy });
        } catch (e) {
          return fail(String((e && e.message) || e), 200, { manual: true, address: engine.pacUrl() });
        }

      case 'POST /api/browser/open': {
        // в браузере без подмены открывать нечего: включаем её вместе с запуском
        proxy.setEnabled(true);
        const r = engine.openBrowser();
        engine.events.emit('state');
        return r.ok ? ok({ browser: r.browser }) : fail(r.error);
      }

      case 'POST /api/proxy/off':
        try {
          await engine.disableSystemProxy();
          return ok({ systemProxy: (await state()).systemProxy });
        } catch (e) {
          return fail(String((e && e.message) || e));
        }

      case 'GET /api/events':
        return {
          status: 200,
          sse: (send) => {
            const onLog = (entry) => send('log', entry);
            const onState = () => send('state', {});
            const onFiles = (names) => send('files', names);
            engine.events.on('log', onLog);
            engine.events.on('state', onState);
            engine.events.on('files', onFiles);
            return () => {
              engine.events.off('log', onLog);
              engine.events.off('state', onState);
              engine.events.off('files', onFiles);
            };
          },
        };

      default:
        return fail('неизвестный маршрут ' + route, 404);
    }
  }

  return { handle, serveStatic };
}
