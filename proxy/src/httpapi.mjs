/**
 * HTTP-транспорт API. Интерфейс Electron использует app://; control.mjs создаёт
 * отдельный сервер с Bearer-токеном. npm start и Vite используют отладочный сервер.
 *
 * Защита от чужих страниц: принимаем только Host=loopback и запросы того же origin
 * (или явно разрешённого, например dev-сервера Vite). DNS rebinding и CSRF не проходят.
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { hostnameOf } from './api.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function createApiServer(engine, { allowedOrigins = [], token = '', apiOnly = false } = {}) {
  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || '');
    const origin = req.headers.origin;
    const deny = (why) => {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('BodySnatch: ' + why);
    };
    if (!LOOPBACK.has(hostnameOf(host))) return deny('чужой Host');
    if (origin && origin !== `http://${host}` && !allowedOrigins.includes(origin)) return deny('чужой Origin');
    if (req.headers['sec-fetch-site'] === 'cross-site') return deny('межсайтовый запрос');
    if (token) {
      // Управляющий API предназначен для локальных клиентов, а не для страниц браузера.
      if (origin || req.headers['sec-fetch-site']) return deny('браузерный запрос');
      const supplied = Buffer.from(String(req.headers.authorization || ''));
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(JSON.stringify({ ok: false, error: 'требуется Bearer token' }));
      }
    }
    if (apiOnly && !/^\/api\//.test(req.url || '')) {
      res.writeHead(404);
      return res.end();
    }

    const chunks = [];
    let body = {};
    try {
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 1024 * 1024) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'тело запроса больше 1 MiB' }));
          req.resume();
          return;
        }
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      body = raw ? JSON.parse(raw) : {};
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('ожидается JSON-объект');
    } catch {
      if (res.destroyed) return;
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'некорректный JSON-объект' }));
    }

    let r;
    try {
      r = await engine.api.handle(req.method, req.url, body);
    } catch (e) {
      r = { status: 500, json: { ok: false, error: String((e && e.message) || e) } };
    }

    if (r.sse) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': ok\n\n');
      const off = r.sse((event, data) => {
        if (res.destroyed) return;
        // Медленный/зависший клиент не должен удерживать бесконечную очередь журнала.
        if (res.writableLength > 1024 * 1024) return res.destroy();
        return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      });
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 25000);
      heartbeat.unref();
      res.on('close', () => {
        clearInterval(heartbeat);
        off();
      });
      return undefined;
    }
    if (r.json !== undefined) {
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(r.json));
    }
    res.writeHead(r.status, r.headers || {});
    return res.end(r.body);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;

  return {
    server,
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve(server.address().port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
