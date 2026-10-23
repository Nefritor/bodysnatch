/**
 * MITM-прокси: перехватывает HTTP и HTTPS (CONNECT + свой сертификат для хоста),
 * отдаёт локальные файлы вместо серверных и пробрасывает остальное наверх.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { createLeafIssuer } from './ca.mjs';
import { pickSite, resolveLocal, relForSite } from './rules.mjs';

/**
 * Системные корневые сертификаты.
 *
 * Антивирус (Kaspersky, ESET) или корпоративный прокси часто вскрывают TLS и
 * подписывают соединение своим корнем. Windows такой корень знает, а Node
 * доверяет только встроенному набору — отсюда «unable to verify the first
 * certificate» на внешне нормальном сайте. Поэтому к встроенным корням
 * добавляем системное хранилище; проверка сертификатов при этом остаётся.
 */
const upstreamAgent = (() => {
  try {
    const system =
      typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
    if (!system || !system.length) return null;
    console.log(
      '[bodysnatch] доверяем системным корням: +' + system.length + ' (всего ' + (tls.rootCertificates.length + system.length) + ')',
    );
    return new https.Agent({
      ca: [...tls.rootCertificates, ...system],
      keepAlive: true,
      maxSockets: 64,
    });
  } catch (e) {
    console.log('[bodysnatch] системные корни недоступны: ' + e.message);
    return null;
  }
})();

export const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.tmpl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createProxy({ config, ca, log = () => {}, api = null, enabled = true, upstreamTimeoutMs = 20000 }) {
  const leafFor = createLeafIssuer(ca);
  const contexts = new Map();
  const logs = [];
  const state = { enabled };
  let hits = { local: 0, remote: 0 };

  const ctxFor = (host) => {
    if (contexts.has(host)) return contexts.get(host);
    const leaf = leafFor(host);
    const ctx = tls.createSecureContext({ key: leaf.keyPem, cert: leaf.certPem });
    contexts.set(host, ctx);
    return ctx;
  };

  const record = (entry) => {
    const line = { t: new Date().toISOString().slice(11, 23), ...entry };
    logs.unshift(line);
    if (logs.length > 500) logs.length = 500;
    log(`${line.via} ${line.status} ${line.url}${line.note ? ' — ' + line.note : ''}`);
  };

  const sendLocal = (res, file, via, url, moduleName = '') => {
    let body;
    try {
      body = fs.readFileSync(file);
    } catch (e) {
      record({ via: 'error', status: 500, url, note: String(e.message || e) });
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('BodySnatch: не читается ' + file);
    }
    const ext = path.extname(file).toLowerCase();
    // CSS отдаём байт в байт: в MITM файл приходит по тому же URL, что и с сервера,
    // поэтому относительные url() разрешаются браузером правильно и переписывать их не нужно.
    record({ via, status: 200, url, note: file, file, module: moduleName, bytes: body.length });
    hits.local += 1;
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      'x-bodysnatch': `${via}:${file}`,
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    });
    res.end(body);
  };

  const forward = async (req, res, url) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (HOP.has(key) || key === 'host' || key.startsWith('proxy-') || key === 'accept-encoding') continue;
      headers[key] = v;
    }
    headers['accept-encoding'] = 'identity';
    if (req.method === 'HEAD') {
      record({ via: 'passthrough', status: 0, url, note: 'HEAD' });
      hits.remote += 1;
      res.writeHead(200, { 'cache-control': 'no-store' });
      return res.end();
    }
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(Buffer.alloc(0)));
      });
    }
    const acTarget = new URL(url);
    const isHttps = acTarget.protocol === 'https:';
    await new Promise((resolve) => {
      const libPromise = isHttps ? import('node:https') : import('node:http');
      void libPromise.then((lib) => {
        let bytes = 0;
        const upReq = lib.request(
          acTarget,
          {
            method: req.method,
            headers,
            // happy-eyeballs: если у хоста есть IPv6, но сети по нему нет,
            // Node сам уйдёт на IPv4 вместо «fetch failed»
            autoSelectFamily: true,
            autoSelectFamilyAttemptTimeout: 800,
            timeout: upstreamTimeoutMs,
            // Антивирусы и корпоративные прокси подменяют цепочку TLS своим
            // корнем: Windows ему доверяет, а Node — только своим. Поэтому
            // к встроенным корням добавляем системное хранилище.
            ...(isHttps && upstreamAgent ? { agent: upstreamAgent } : {}),
          },
          (up) => {
            const out = {};
            for (const [k, v] of Object.entries(up.headers)) {
              const key = k.toLowerCase();
              if (HOP.has(key) || key === 'content-encoding' || key === 'content-length') continue;
              // CSP сайта мешает жить при локальной отладке — снимаем
              if (key === 'content-security-policy' || key === 'content-security-policy-report-only') continue;
              // был return — он выходил из обработчика ответа целиком, и запрос
              // «висел» до таймаута; пропуск делается через continue
              if (key === 'x-frame-options') continue;
              out[key] = v;
            }
            out['cache-control'] = 'no-store, no-cache, must-revalidate';
            up.on('data', (chunk) => {
              bytes += chunk.length;
            });
            up.on('end', () => {
              record({ via: 'passthrough', status: up.statusCode, url, bytes });
              hits.remote += 1;
            });
            res.writeHead(up.statusCode || 502, out);
            up.pipe(res);
            resolve();
          },
        );

        upReq.on('timeout', () => upReq.destroy(new Error('таймаут ожидания сервера')));
        upReq.on('error', (e) => {
          record({ via: 'error', status: 502, url, note: String(e.message || e) });
          try {
            res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('BodySnatch: нет ответа от ' + url + '\n' + String(e.message || e));
          } catch {
            /* ответ уже ушёл */
          }
          resolve();
        });
        if (body) upReq.write(body);
        upReq.end();
      });
    });
  };

  const handle = async (req, res) => {
    // Запросы к самому приложению (интерфейс и API) идут с Host = 127.0.0.1,
    // а не с сайта — их не проксируем, а отдаём своему API.
    const host = String(req.headers.host || '');
    const ownOrigin = !/^https?:\/\//i.test(req.url || '') && /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
    if (ownOrigin && api) {
      try {
        await api(req, res);
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
      return;
    }
    if (req.url && req.url.startsWith('/api/')) {
      if (api) {
        try {
          await api(req, res);
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'нет API' }));
    }

    let url;
    try {
      url = /^https?:\/\//i.test(req.url)
        ? req.url
        : `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}${req.url}`;
    } catch {
      url = req.url;
    }
    let target;
    try {
      target = new URL(url);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('BodySnatch: некорректный адрес');
    }

    // Свои же запросы (интерфейс и API) нельзя отправлять наверх: браузер может
    // прислать их уже как прокси-запрос, и получится рекурсия «прокси → сам себя».
    const loopback = target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '::1';
    if (loopback) {
      const pathname = target.pathname + (target.search || '');
      if (api) {
        const fakeReq = Object.create(req);
        fakeReq.url = pathname;
        try {
          await api(fakeReq, res);
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('BodySnatch: локальный адрес без API');
    }

    const site = pickSite(config, url);
    // подмена на паузе (свитч выключен): всё уходит на сервер как обычно
    const local = state.enabled && site ? resolveLocal(config, site, target) : null;

    if (local && local.file) return sendLocal(res, local.file, local.via, url, local.moduleName || '');
    if (local && local.missing && site && site.useLocal !== false) {
      record({ via: 'map-miss', status: 0, url, note: String(local.missing) });
    }
    if (!state.enabled && site) record({ via: 'paused', status: 0, url });
    return forward(req, res, url);
  };

  const server = http.createServer(handle);
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  server.on('connect', (req, socket, head) => {
    const hostPort = String(req.url || '');
    const host = hostPort.split(':')[0];
    const hostPortNum = Number(hostPort.split(':')[1] || 443);
    if (!host) {
      socket.destroy();
      return;
    }
    // к себе — только прозрачный туннель, без MITM: иначе интерфейс ходит по кругу
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
      const upstream = net.connect(
        { port: hostPortNum, host, autoSelectFamily: true },
        () => {
          socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: BodySnatch\r\n\r\n');
          if (head && head.length) upstream.write(head);
          upstream.pipe(socket);
          socket.pipe(upstream);
        },
      );
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      return;
    }
    socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: BodySnatch\r\n\r\n');
    let ctx;
    try {
      ctx = ctxFor(host);
    } catch (e) {
      record({ via: 'error', status: 500, url: `https://${host}/`, note: 'сертификат: ' + String(e.message || e) });
      socket.destroy();
      return;
    }
    const tlsSocket = new tls.TLSSocket(socket, {
      isServer: true,
      secureContext: ctx,
      ALPNProtocols: ['http/1.1'],
      requestCert: false,
    });
    tlsSocket.on('error', () => {
      try {
        socket.destroy();
      } catch {}
    });
    if (head && head.length) tlsSocket.unshift(head);
    inner.emit('connection', tlsSocket);
  });

  const inner = http.createServer(handle);
  inner.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  return {
    server,
    logs,
    clearLog: () => {
      logs.length = 0;
    },
    state,
    stats: () => ({ ...hits }),
    setEnabled: (v) => {
      state.enabled = !!v;
      record({ via: 'switch', status: 0, url: '/', note: state.enabled ? 'подмена включена' : 'подмена на паузе' });
      return state.enabled;
    },
    listen: (port, host = '127.0.0.1') =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      }),
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) {
          try {
            s.destroy();
          } catch {}
        }
        sockets.clear();
        try {
          inner.close();
        } catch {}
        server.close(() => resolve());
      }),
  };
}
