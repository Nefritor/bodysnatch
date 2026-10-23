/**
 * Отладочный HTTP-сервер для API (режим `npm start` и тесты). В приложении не используется:
 * там интерфейс ходит в API через протокол app://, без сетевого порта.
 *
 * Защита от чужих страниц: принимаем только Host=loopback и запросы того же origin
 * (или явно разрешённого, например dev-сервера Vite). DNS rebinding и CSRF не проходят.
 */
import http from 'node:http';
import { hostnameOf } from './api.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function createApiServer(engine, { allowedOrigins = [] } = {}) {
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

    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* пустое тело */
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
      const off = r.sse((event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      res.on('close', off);
      return undefined;
    }
    if (r.json !== undefined) {
      res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(r.json));
    }
    res.writeHead(r.status, r.headers || {});
    return res.end(r.body);
  });

  return {
    server,
    listen: (port) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
