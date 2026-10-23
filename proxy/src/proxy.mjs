/**
 * MITM-прокси: вскрывает HTTPS (CONNECT + свой сертификат) только для хостов из масок,
 * отдаёт локальные файлы вместо серверных и пробрасывает остальное наверх как есть.
 * Хосты вне масок идут сырым туннелем: мы их не читаем и не меняем.
 */
import http from 'node:http';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { createLeafIssuer } from './ca.mjs';
import { pickSite, resolveLocal, hostMatches, syncFs } from './rules.mjs';
import { createUpstream } from './upstream.mjs';

export const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.tmpl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
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

const LIVE_PATH = '/__bodysnatch/';
const LIVE_SCRIPT = `(()=>{if(window.__bsLR)return;window.__bsLR=1;const es=new EventSource('${LIVE_PATH}events');es.onmessage=(e)=>{let d;try{d=JSON.parse(e.data)}catch{return}if(d.type==='css'){document.querySelectorAll('link[rel~=stylesheet]').forEach((l)=>{const u=new URL(l.href);u.searchParams.set('__bs',Date.now());const n=l.cloneNode();n.href=u.href;n.onload=()=>l.remove();l.after(n)})}else location.reload()}})();`;
const LIVE_TAG = `<script src="${LIVE_PATH}livereload.js"></script>`;

const isLoopback = (h) => h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
const LOG_CAP = 600;

/**
 * @param {object} o
 * @param {object} o.config
 * @param {object} o.ca
 * @param {{isFile(p:string):boolean, exists(p:string):boolean}} [o.files] проверки файлов (кэширующие)
 * @param {ReturnType<typeof createUpstream>} [o.upstream]
 * @param {() => string | null} [o.pac] текст PAC для /proxy.pac
 * @param {(entry: object) => void} [o.onLog] новая запись журнала
 * @param {() => void} [o.onChange] изменилось состояние (свитч)
 */
export function createProxy({
  config,
  ca,
  files = syncFs,
  upstream = createUpstream(),
  pac = null,
  onLog = () => {},
  onChange = () => {},
  log = () => {},
  enabled = true,
  upstreamTimeoutMs = 30000,
}) {
  const leafFor = createLeafIssuer(ca);
  const contexts = new Map();
  const logs = [];
  const state = { enabled };
  const hits = { local: 0, remote: 0 };
  const sse = new Set();
  let ownPort = 0;

  const ctxFor = (host) => {
    let ctx = contexts.get(host);
    if (!ctx) {
      const leaf = leafFor(host);
      ctx = tls.createSecureContext({ key: leaf.keyPem, cert: leaf.certPem });
      contexts.set(host, ctx);
    }
    return ctx;
  };

  const record = (entry) => {
    const line = { t: new Date().toISOString().slice(11, 23), ...entry };
    logs.push(line);
    if (logs.length > LOG_CAP + 100) logs.splice(0, logs.length - LOG_CAP);
    log(`${line.via} ${line.status} ${line.url}${line.note ? ' — ' + line.note : ''}`);
    onLog(line);
  };

  const plain = (res, code, text) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(text);
  };

  const targetOf = (req, secure) => {
    const raw = String(req.url || '');
    if (/^https?:\/\//i.test(raw)) return new URL(raw);
    return new URL(`${secure ? 'https' : 'http'}://${req.headers.host}${raw}`);
  };

  // ── локальные файлы ────────────────────────────────────────────────────────
  const sendLocal = (req, res, local, url) => {
    const file = local.file;
    let st;
    try {
      st = fs.statSync(file);
    } catch (e) {
      record({ via: 'error', status: 500, url, note: String(e.message || e) });
      return plain(res, 500, 'BodySnatch: не читается ' + file);
    }
    const etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      etag,
      'last-modified': st.mtime.toUTCString(),
      // no-cache = «каждый раз спроси у прокси»: изменение файла видно сразу, а
      // неизменённый файл браузер получает ответом 304 без тела
      'cache-control': 'no-cache',
      'x-bodysnatch': `${local.via}:${file}`,
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    };
    hits.local += 1;
    record({ via: local.via, status: 200, url, note: file, file, module: local.moduleName || '', bytes: st.size });
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };

  // ── проброс на сервер ──────────────────────────────────────────────────────
  const forward = (req, res, target) => {
    const url = target.href;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP.has(k) || k === 'host' || k.startsWith('proxy-')) continue;
      headers[k] = v;
    }
    const injectLive =
      config.liveReload === true &&
      req.method === 'GET' &&
      (req.headers['sec-fetch-dest'] === 'document' || /text\/html/.test(String(req.headers.accept || '')));
    // чтобы вставить скрипт, нужен несжатый HTML; остальные ответы идут как есть
    if (injectLive) headers['accept-encoding'] = 'identity';

    const upReq = upstream.request(target, { method: req.method, headers, timeout: upstreamTimeoutMs }, (up) => {
      const out = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (HOP.has(k)) continue;
        // CSP и X-Frame-Options сайта мешают локальной отладке; снимаем только на подменяемых хостах
        if (k === 'content-security-policy' || k === 'content-security-policy-report-only' || k === 'x-frame-options')
          continue;
        out[k] = v;
      }
      // браузер должен приходить за файлом к нам, а не брать его из своего кэша;
      // etag/last-modified остаются, поэтому неизменённое придёт ответом 304
      out['cache-control'] = 'no-cache';
      delete out.expires;
      delete out.pragma;

      const isHtml = /text\/html/i.test(String(out['content-type'] || ''));
      if (injectLive && isHtml && !out['content-encoding'] && up.statusCode === 200) {
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, LIVE_TAG + '</head>') : LIVE_TAG + html;
          const body = Buffer.from(html, 'utf8');
          out['content-length'] = body.length;
          delete out.etag;
          res.writeHead(200, out);
          res.end(body);
          hits.remote += 1;
          record({ via: 'passthrough', status: 200, url, bytes: body.length, note: 'live-reload' });
        });
        return;
      }

      let bytes = 0;
      up.on('data', (c) => {
        bytes += c.length;
      });
      up.on('end', () => {
        hits.remote += 1;
        record({ via: 'passthrough', status: up.statusCode, url, bytes });
      });
      res.writeHead(up.statusCode || 502, up.statusMessage, out);
      up.pipe(res);
    });

    upReq.on('timeout', () => upReq.destroy(new Error('таймаут ожидания сервера')));
    upReq.on('error', (e) => {
      record({ via: 'error', status: 502, url, note: String(e.message || e) });
      plain(res, 502, 'BodySnatch: нет ответа от ' + url + '\n' + String(e.message || e));
    });
    // клиент ушёл, не дождавшись ответа — не держим соединение с сервером
    res.on('close', () => {
      if (!res.writableEnded) upReq.destroy();
    });

    const hasBody = req.headers['content-length'] > 0 || req.headers['transfer-encoding'];
    if (hasBody) req.pipe(upReq);
    else upReq.end();
  };

  // ── служебные адреса на подменяемых хостах ──────────────────────────────────
  const serveInternal = (req, res, target) => {
    if (target.pathname === LIVE_PATH + 'livereload.js') {
      res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
      return res.end(LIVE_SCRIPT);
    }
    if (target.pathname === LIVE_PATH + 'events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(': ok\n\n');
      sse.add(res);
      res.on('close', () => sse.delete(res));
      return undefined;
    }
    return plain(res, 404, 'BodySnatch');
  };

  const handle = async (req, res) => {
    try {
      let target;
      try {
        target = targetOf(req, !!req.socket.encrypted);
      } catch {
        return plain(res, 400, 'BodySnatch: некорректный адрес');
      }

      // обращения к самому прокси: только PAC; всё остальное — не наше дело и не повод для рекурсии
      if (isLoopback(target.hostname) && Number(target.port || 80) === ownPort) {
        if (target.pathname === '/proxy.pac' && pac) {
          res.writeHead(200, {
            'content-type': 'application/x-ns-proxy-autoconfig',
            'cache-control': 'no-store',
          });
          return res.end(pac() || '');
        }
        return plain(res, 404, 'BodySnatch');
      }

      if (target.pathname.startsWith(LIVE_PATH) && hostMatches(config, target.hostname)) {
        return serveInternal(req, res, target);
      }

      const site = state.enabled ? pickSite(config, target.href) : null;
      const local = site ? resolveLocal(config, site, target, files) : null;
      if (local && local.file) return sendLocal(req, res, local, target.href);
      if (local && local.missing && site.useLocal !== false) {
        record({ via: 'map-miss', status: 0, url: target.href, note: String(local.missing) });
      }
      return forward(req, res, target);
    } catch (e) {
      record({ via: 'error', status: 500, url: String(req.url || ''), note: String((e && e.message) || e) });
      return plain(res, 500, 'BodySnatch: внутренняя ошибка');
    }
  };

  // ── WebSocket и прочие Upgrade ────────────────────────────────────────────
  const upgrade = (secure) => (req, socket, head) => {
    socket.on('error', () => {});
    let target;
    try {
      target = targetOf(req, secure);
    } catch {
      return socket.destroy();
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k.startsWith('proxy-')) continue;
      headers[k] = v;
    }
    const upReq = upstream.request(target, { method: req.method, headers, timeout: 0 }, (up) => {
      // сервер не согласился на Upgrade — отдаём его ответ как есть
      const lines = [`HTTP/1.1 ${up.statusCode} ${up.statusMessage || ''}`];
      for (let i = 0; i < up.rawHeaders.length; i += 2) lines.push(`${up.rawHeaders[i]}: ${up.rawHeaders[i + 1]}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      up.pipe(socket);
    });
    upReq.on('upgrade', (up, upSocket, upHead) => {
      upSocket.on('error', () => socket.destroy());
      const lines = [`HTTP/1.1 ${up.statusCode} ${up.statusMessage || 'Switching Protocols'}`];
      for (let i = 0; i < up.rawHeaders.length; i += 2) lines.push(`${up.rawHeaders[i]}: ${up.rawHeaders[i + 1]}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (upHead && upHead.length) socket.write(upHead);
      if (head && head.length) upSocket.write(head);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      // обрыв любой стороны закрывает вторую, иначе соединение с сервером повиснет
      socket.on('close', () => upSocket.destroy());
      upSocket.on('close', () => socket.destroy());
      record({ via: 'websocket', status: up.statusCode, url: target.href });
    });
    upReq.on('error', (e) => {
      record({ via: 'error', status: 502, url: target.href, note: String(e.message || e) });
      socket.destroy();
    });
    upReq.end();
  };

  const track = (s, set) => {
    set.add(s);
    s.on('close', () => set.delete(s));
  };
  const sockets = new Set();

  const server = http.createServer(handle);
  server.on('connection', (s) => track(s, sockets));
  server.on('upgrade', upgrade(false));

  const inner = http.createServer(handle);
  inner.on('upgrade', upgrade(true));

  // ── CONNECT: вскрываем только хосты из масок ──────────────────────────────
  server.on('connect', async (req, socket, head) => {
    socket.on('error', () => {});
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(String(req.url || ''));
    if (!m) return socket.destroy();
    const host = m[1].toLowerCase();
    const port = Number(m[2]);

    const intercept = state.enabled && !isLoopback(host) && hostMatches(config, host);
    if (!intercept) {
      try {
        const remote = await upstream.tunnel(host, port);
        socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: BodySnatch\r\n\r\n');
        if (head && head.length) remote.write(head);
        remote.on('error', () => socket.destroy());
        socket.on('close', () => remote.destroy());
        remote.on('close', () => socket.destroy());
        remote.pipe(socket);
        socket.pipe(remote);
      } catch {
        if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      }
      return undefined;
    }

    let ctx;
    try {
      ctx = ctxFor(host);
    } catch (e) {
      record({ via: 'error', status: 500, url: `https://${host}/`, note: 'сертификат: ' + String(e.message || e) });
      return socket.destroy();
    }
    socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: BodySnatch\r\n\r\n');
    const tlsSocket = new tls.TLSSocket(socket, {
      isServer: true,
      secureContext: ctx,
      ALPNProtocols: ['http/1.1'],
      requestCert: false,
    });
    tlsSocket.on('error', () => socket.destroy());
    if (head && head.length) tlsSocket.unshift(head);
    track(tlsSocket, sockets);
    inner.emit('connection', tlsSocket);
    return undefined;
  });

  const heartbeat = setInterval(() => {
    for (const res of sse) res.write(': \n\n');
  }, 25000);
  heartbeat.unref();

  return {
    server,
    state,
    /** журнал, новые записи первыми */
    get logs() {
      return logs.slice().reverse();
    },
    clearLog: () => {
      logs.length = 0;
    },
    stats: () => ({ ...hits }),
    setEnabled: (v) => {
      state.enabled = !!v;
      record({ via: 'switch', status: 0, url: '/', note: state.enabled ? 'подмена включена' : 'подмена на паузе' });
      onChange();
      return state.enabled;
    },
    /** сообщить открытым страницам, что файлы изменились */
    notifyFilesChanged: (names) => {
      if (!config.liveReload || !sse.size) return;
      const onlyCss = names.length > 0 && names.every((n) => /\.css$/i.test(n));
      const payload = `data: ${JSON.stringify({ type: onlyCss ? 'css' : 'reload' })}\n\n`;
      for (const res of sse) res.write(payload);
    },
    listen: (port, host = '127.0.0.1') =>
      new Promise((resolve, reject) => {
        const onError = (e) => reject(e);
        server.once('error', onError);
        server.listen(port, host, () => {
          server.off('error', onError);
          ownPort = server.address().port;
          resolve(server.address());
        });
      }),
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        for (const s of sockets) s.destroy();
        sockets.clear();
        for (const res of sse) res.end();
        sse.clear();
        inner.close();
        server.close(() => resolve());
        upstream.close();
      }),
  };
}
