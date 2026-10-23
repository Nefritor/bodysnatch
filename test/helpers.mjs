/** Общее для тестов: сервер «сайта», подмена выхода наверх, запросы через прокси. */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { ensureCA } from '../proxy/src/ca.mjs';
import { normalizeConfig } from '../proxy/src/config.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';

export const tmpdir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `bs-${name}-`));

export const HOST = 'cdn.example.test';

/** Конфиг: сайт по маске HOST, модуль `mod` лежит в root. */
export function makeConfig(root, extra = {}) {
  return normalizeConfig({
    roots: [root],
    moduleRoots: { mod: root },
    sites: [{ id: 'site', enabled: true, useLocal: true, match: [`https://${HOST}`, `http://${HOST}`] }],
    ...extra,
  });
}

export function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** «Настоящий сервер»: ведёт журнал запросов и отвечает handler-ом. */
export async function startSite(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    handler(req, res);
  });
  const port = await listen(server);
  return { port, seen, server, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

/** Выход наверх, который всегда идёт на локальный «сайт». */
export function fakeUpstream(port, { onTunnel } = {}) {
  return {
    request(target, options, cb) {
      return http.request({ host: '127.0.0.1', port, path: target.pathname + target.search, ...options }, cb);
    },
    tunnel(host, p) {
      onTunnel?.(host, p);
      return new Promise((resolve, reject) => {
        const s = net.connect({ host: '127.0.0.1', port }, () => resolve(s));
        s.once('error', reject);
      });
    },
    close() {},
  };
}

export async function startProxy({ root, siteHandler = (req, res) => res.end('server'), config, upstreamOpts, proxyOpts = {} }) {
  const site = await startSite(siteHandler);
  const ca = ensureCA(tmpdir('ca'));
  const cfg = config || makeConfig(root);
  const proxy = createProxy({
    config: cfg,
    ca,
    upstream: fakeUpstream(site.port, upstreamOpts),
    pac: () => 'function FindProxyForURL(){return "DIRECT"}',
    ...proxyOpts,
  });
  const addr = await proxy.listen(0);
  return {
    proxy,
    site,
    ca,
    config: cfg,
    port: addr.port,
    async close() {
      await proxy.close();
      await site.close();
    },
  };
}

/** Обычный HTTP через прокси (абсолютный URL в строке запроса). */
export function viaProxy(port, url, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: u.host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** HTTPS через CONNECT; сертификат проверяется по корню CA. */
export function httpsViaProxy(port, ca, host, urlPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const connect = http.request({ host: '127.0.0.1', port, method: 'CONNECT', path: `${host}:443` });
    connect.on('error', reject);
    connect.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error('CONNECT ' + res.statusCode));
      const secure = tls.connect({ socket, servername: host, ca: ca.certPem });
      secure.on('error', reject);
      secure.on('secureConnect', () => {
        const req = http.request({ createConnection: () => secure, host, method, path: urlPath, headers: { host, ...headers } }, (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => {
            secure.destroy();
            resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') });
          });
        });
        req.on('error', reject);
        req.end();
      });
    });
    connect.end();
  });
}
