/**
 * HTTP-API для интерфейса: состояние, конфиг, сертификат, системный прокси.
 */
import fs from 'node:fs';
import path from 'node:path';
import { saveConfig } from './config.mjs';
import { buildRoots, buildModules, firstSite } from './scan.mjs';
import * as sysproxy from './sysproxy.mjs';
import * as certinstall from './certinstall.mjs';

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });

export function makeApi({
  config,
  ca,
  proxy,
  certsDir,
  snapshot,
  distDir = null,
  version = '0.1.0',
  onQuit = async () => process.exit(0),
}) {
  let proxyBefore = snapshot || null;

  /** Отдать собранный интерфейс (Vite dist) с SPA-фолбэком. */
  const serveStatic = (req, res) => {
    if (!distDir || !fs.existsSync(distDir)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('интерфейс не собран: npm run build:ui');
    }
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const abs = path.resolve(distDir, rel);
    const inside = abs === path.resolve(distDir) || abs.startsWith(path.resolve(distDir) + path.sep);
    const file = inside && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(distDir, 'index.html');
    const ext = path.extname(file).toLowerCase();
    const type =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
      }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(fs.readFileSync(file));
  };

  return async function api(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (!route.startsWith('/api/')) {
      if (method === 'GET' || method === 'HEAD') return serveStatic(req, res);
      res.writeHead(405);
      return res.end();
    }

    if (route === '/api/state' && method === 'GET') {
      const trusted = certinstall.isTrusted(ca.certPem);
      const sys = sysproxy.getSystemProxy();
      const roots = buildRoots(config);
      const site = firstSite(config);
      return json(res, 200, {
        ok: true,
        version,
        enabled: proxy.state.enabled,
        configPath: config.__path,
        config: {
          sites: config.sites,
          roots: config.roots,
          moduleRoots: config.moduleRoots,
          servicePrefixes: config.servicePrefixes,
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
        port: Number(config.port) || 0,
        stats: proxy.stats(),
        cert: {
          trusted,
          thumbprint: certinstall.thumbprintOf(ca.certPem),
          certPath: ca.certPath,
          created: ca.created,
          install: certinstall.lastInstallResult(),
          check: certinstall.lastCheckResult(),
          elevated: sysproxy.isElevated(),
          lowIntegrity: sysproxy.isLowIntegrity(),
        },
        systemProxy: { ...sys, ours: sysproxy.isOurs(Number(config.port) || 0) },
        proxyWritable: sysproxy.canWriteProxy(),
        elevated: sysproxy.isElevated(),
      });
    }

    if (route === '/api/log' && method === 'GET') {
      return json(res, 200, { ok: true, log: proxy.logs.slice(0, Number(url.searchParams.get('n') || 200)) });
    }

    if (route === '/api/log/clear' && method === 'POST') {
      proxy.clearLog();
      return json(res, 200, { ok: true });
    }

    if (route === '/api/enabled' && method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, { ok: true, enabled: proxy.setEnabled(!!body.enabled) });
    }

    if (route === '/api/config' && method === 'GET') {
      return json(res, 200, {
        ok: true,
        config: { sites: config.sites, roots: config.roots, moduleRoots: config.moduleRoots },
      });
    }

    if (route === '/api/config' && method === 'POST') {
      const raw = await readBody(req);
      const body = raw && raw.config && typeof raw.config === 'object' ? raw.config : raw;
      if (body && Array.isArray(body.sites)) config.sites = body.sites;
      if (body && Array.isArray(body.roots)) config.roots = body.roots;
      if (body && body.moduleRoots && typeof body.moduleRoots === 'object') config.moduleRoots = body.moduleRoots;
      if (body && Array.isArray(body.servicePrefixes)) config.servicePrefixes = body.servicePrefixes;
      saveConfig(config);
      return json(res, 200, { ok: true });
    }

    if (route === '/api/open' && method === 'POST') {
      const body = await readBody(req);
      const target = String(body.path || body.root || '');
      if (!target) return json(res, 400, { ok: false, message: 'не указан путь' });
      const { spawn } = await import('node:child_process');
      log('открыть папку: ' + target);
      // сначала explorer, затем запасной путь через start — на случай,
      // если explorer недоступен из процесса прокси
      let lastError = '';
      for (const [cmd, args] of [
        ['explorer', [target]],
        ['cmd', ['/c', 'start', '', target]],
      ]) {
        try {
          const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
          child.on('error', (e) => log('открыть папку: ошибка — ' + String(e.message || e)));
          child.unref();
          return json(res, 200, { ok: true, via: cmd });
        } catch (e) {
          lastError = String(e.message || e);
          log('открыть папку: не удалось — ' + lastError);
        }
      }
      return json(res, 200, { ok: false, message: lastError || 'не удалось запустить проводник' });
    }

    if (route === '/api/quit' && method === 'POST') {
      json(res, 200, { ok: true });
      setTimeout(() => {
        onQuit().catch(() => process.exit(0));
      }, 100);
      return undefined;
    }

    if (route === '/api/cert/install' && method === 'POST') {
      const r = certinstall.install(ca.certPem, certsDir);
      return json(res, 200, {
        ok: r.ok,
        started: !!r.started,
        via: r.via,
        file: r.file,
        error: r.error,
        last: certinstall.lastInstallResult(),
        command: certinstall.installCommand(certsDir),
        trusted: certinstall.isTrusted(ca.certPem),
      });
    }

    if (route === '/api/cert/uninstall' && method === 'POST') {
      const ok = certinstall.uninstall(ca.certPem);
      return json(res, 200, { ok, trusted: certinstall.isTrusted(ca.certPem) });
    }

    if (route === '/api/cert/file' && method === 'GET') {
      const file = certinstall.writePem(ca.certPem, certsDir);
      res.writeHead(200, {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': `attachment; filename="BodySnatch Desktop Root CA.crt"`,
      });
      return res.end(fs.readFileSync(file));
    }

    if (route === '/api/proxy/on' && method === 'POST') {
      const port = Number(config.port) || 8180;
      try {
        proxyBefore = sysproxy.apply(port);
        const sys = sysproxy.getSystemProxy();
        return json(res, 200, {
          ok: true,
          elevated: !!proxyBefore.elevated,
          systemProxy: { ...sys, ours: sysproxy.isOurs(port) },
        });
      } catch (e) {
        const cancelled = !!(e && e.cancelled);
        return json(res, 200, {
          ok: false,
          cancelled,
          error: String((e && e.message) || e),
          manual: !cancelled,
          address: `127.0.0.1:${port}`,
          systemProxy: { ...sysproxy.getSystemProxy(), ours: sysproxy.isOurs(port) },
        });
      }
    }

    if (route === '/api/proxy/repair' && method === 'POST') {
      const port = Number(config.port) || 8180;
      const repaired = sysproxy.repairAccess();
      let enabled = false;
      let error = '';
      try {
        proxyBefore = sysproxy.apply(port);
        enabled = sysproxy.isOurs(port);
      } catch (e) {
        error = String((e && e.message) || e);
      }
      const sys = sysproxy.getSystemProxy();
      return json(res, 200, {
        ok: enabled,
        repaired: repaired.repaired,
        repairErrors: repaired.errors,
        error,
        systemProxy: { ...sys, ours: sysproxy.isOurs(port) },
      });
    }

    if (route === '/api/proxy/diagnose' && method === 'GET') {
      return json(res, 200, { ok: true, ...sysproxy.diagnose() });
    }

    if (route === '/api/open-settings' && method === 'POST') {
      try {
        const { spawn } = await import('node:child_process');
        spawn('cmd', ['/c', 'start', '', 'ms-settings:network-proxy'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 200, { ok: false, message: String(e.message || e) });
      }
    }

    if (route === '/api/proxy/off' && method === 'POST') {
      const port = Number(config.port) || 8180;
      const r = sysproxy.restore(proxyBefore, port);
      const sys = sysproxy.getSystemProxy();
      return json(res, 200, {
        ok: r.ok,
        error: r.ok ? undefined : r.error || 'прокси не выключился',
        elevated: !!r.elevated,
        systemProxy: { ...sys, ours: sysproxy.isOurs(port) },
        machine: r.machine,
      });
    }

    if (route === '/api/module-root' && method === 'POST') {
      const body = await readBody(req);
      const module = String(body.module || '');
      if (!module) return json(res, 400, { ok: false, message: 'не указан модуль' });
      if (body.root) config.moduleRoots[module] = String(body.root);
      else delete config.moduleRoots[module];
      saveConfig(config);
      return json(res, 200, { ok: true });
    }

    if (route === '/api/pick-folder' && method === 'POST') {
      // системный диалог выбора папки (Windows): работает и в браузере, и в нативном окне
      try {
        const { execFileSync } = await import('node:child_process');
        const script = [
          'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
          '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
          "$d.Description = 'Выберите папку с кодом'",
          "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
        ].join('; ');
        const out = execFileSync('powershell', ['-NoProfile', '-STA', '-Command', script], {
          encoding: 'utf8',
          windowsHide: true,
        });
        const picked = String(out || '').trim();
        return json(res, 200, picked ? { ok: true, path: picked } : { ok: false, message: 'отменено' });
      } catch (e) {
        return json(res, 200, { ok: false, message: String(e.message || e) });
      }
    }

    return json(res, 404, { ok: false, error: 'неизвестный маршрут ' + route });
  };
}
