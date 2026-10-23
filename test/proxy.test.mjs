import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startProxy, viaProxy, httpsViaProxy, tmpdir, HOST, makeConfig } from './helpers.mjs';

const setup = async (siteHandler, extra = {}) => {
  const root = tmpdir('proxy');
  fs.mkdirSync(path.join(root, 'mod'));
  fs.writeFileSync(path.join(root, 'mod', 'Page.js'), 'LOCAL');
  const ctx = await startProxy({ root, siteHandler, ...extra });
  return { ...ctx, root };
};

const serverReply = (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/javascript',
    'content-security-policy': "default-src 'none'",
    'x-frame-options': 'DENY',
    'cache-control': 'max-age=3600',
    etag: '"srv"',
  });
  res.end('SERVER');
};

test('подмена: файл из папки вместо серверного, заголовки и 304', async () => {
  const t = await setup(serverReply);
  try {
    const r = await viaProxy(t.port, `http://${HOST}/mod/Page.js`);
    assert.equal(r.status, 200);
    assert.equal(r.body, 'LOCAL');
    assert.match(r.headers['x-bodysnatch'], /^mirror:/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(t.site.seen.length, 0, 'на сервер запрос не ушёл');

    const again = await viaProxy(t.port, `http://${HOST}/mod/Page.js`, {
      headers: { 'if-none-match': r.headers.etag },
    });
    assert.equal(again.status, 304);

    const head = await viaProxy(t.port, `http://${HOST}/mod/Page.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], '5');
  } finally {
    await t.close();
  }
});

test('проброс: файла нет — ответ сервера; CSP снят, кэш = no-cache, HEAD реальный', async () => {
  const t = await setup(serverReply);
  try {
    const r = await viaProxy(t.port, `http://${HOST}/mod/None.js`);
    assert.equal(r.body, 'SERVER');
    assert.equal(r.headers['content-security-policy'], undefined);
    assert.equal(r.headers['x-frame-options'], undefined);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.equal(r.headers.etag, '"srv"');

    await viaProxy(t.port, `http://${HOST}/mod/None.js`, { method: 'HEAD' });
    assert.equal(t.site.seen.at(-1).method, 'HEAD', 'HEAD дошёл до сервера');
  } finally {
    await t.close();
  }
});

test('чужой /api/* на подменяемом хосте уходит на сервер, а не в API приложения', async () => {
  const t = await setup((req, res) => res.end('SITE-API'));
  try {
    const r = await viaProxy(t.port, `http://${HOST}/api/users`);
    assert.equal(r.body, 'SITE-API');
  } finally {
    await t.close();
  }
});

test('кривой URL не роняет процесс', async () => {
  const t = await setup(serverReply);
  try {
    const r = await viaProxy(t.port, `http://${HOST}/mod/%E0%A4%A`);
    assert.equal(r.status, 200);
    assert.equal(r.body, 'SERVER');
  } finally {
    await t.close();
  }
});

test('тело POST доходит до сервера потоком', async () => {
  let got = '';
  const t = await setup((req, res) => {
    req.on('data', (c) => (got += c));
    req.on('end', () => res.end('ok'));
  });
  try {
    const r = await viaProxy(t.port, `http://${HOST}/mod/save`, {
      method: 'POST',
      body: 'payload',
      headers: { 'content-length': '7' },
    });
    assert.equal(r.body, 'ok');
    assert.equal(got, 'payload');
  } finally {
    await t.close();
  }
});

test('пауза: подмена выключена, все запросы идут на сервер', async () => {
  const t = await setup(serverReply);
  try {
    t.proxy.setEnabled(false);
    assert.equal((await viaProxy(t.port, `http://${HOST}/mod/Page.js`)).body, 'SERVER');
    t.proxy.setEnabled(true);
    assert.equal((await viaProxy(t.port, `http://${HOST}/mod/Page.js`)).body, 'LOCAL');
  } finally {
    await t.close();
  }
});

test('HTTPS: хост из маски вскрывается, подмена идёт под нашим сертификатом', async () => {
  const t = await setup(serverReply);
  try {
    const local = await httpsViaProxy(t.port, t.ca, HOST, '/mod/Page.js');
    assert.equal(local.body, 'LOCAL');
    const remote = await httpsViaProxy(t.port, t.ca, HOST, '/mod/None.js');
    assert.equal(remote.body, 'SERVER');
  } finally {
    await t.close();
  }
});

test('HTTPS: хост вне масок идёт сырым туннелем, без нашего сертификата', async () => {
  let tunneled = '';
  const t = await setup(serverReply, { upstreamOpts: { onTunnel: (h, p) => (tunneled = `${h}:${p}`) } });
  try {
    // сертификат «банка» нам не выпускался: если бы прокси вскрыл TLS, handshake прошёл бы с нашим CA
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: t.port, method: 'CONNECT', path: 'bank.example.com:443' });
      req.on('connect', (res, socket) => {
        assert.equal(res.statusCode, 200);
        socket.destroy();
        resolve();
      });
      req.on('error', resolve);
      req.end();
    });
    assert.equal(tunneled, 'bank.example.com:443');
  } finally {
    await t.close();
  }
});

test('PAC отдаётся только на собственном адресе, прочее на loopback — 404', async () => {
  const t = await setup(serverReply);
  try {
    const pac = await viaProxy(t.port, `http://127.0.0.1:${t.port}/proxy.pac`);
    assert.equal(pac.status, 200);
    assert.match(pac.headers['content-type'], /proxy-autoconfig/);
    const other = await viaProxy(t.port, `http://127.0.0.1:${t.port}/api/state`);
    assert.equal(other.status, 404);
  } finally {
    await t.close();
  }
});

test('WebSocket/Upgrade доходит до сервера и работает в обе стороны', async () => {
  const root = tmpdir('ws');
  const t = await startProxy({ root, siteHandler: (req, res) => res.end('x') });
  t.site.server.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(Buffer.from('echo:' + d)));
    socket.on('end', () => socket.end());
  });
  try {
    const got = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: t.port,
        path: `http://${HOST}/ws`,
        headers: { host: HOST, connection: 'Upgrade', upgrade: 'echo' },
      });
      req.on('upgrade', (res, socket) => {
        socket.write('ping');
        socket.once('data', (d) => {
          socket.destroy();
          resolve(String(d));
        });
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(got, 'echo:ping');
  } finally {
    await t.close();
  }
});

test('live reload: в HTML вставляется скрипт, события доходят до страницы', async () => {
  const root = tmpdir('live');
  fs.mkdirSync(path.join(root, 'mod'));
  const config = makeConfig(root, { liveReload: true });
  const t = await startProxy({
    root,
    config,
    siteHandler: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><head></head><body>hi</body></html>');
    },
  });
  try {
    const page = await viaProxy(t.port, `http://${HOST}/index.html`, { headers: { accept: 'text/html' } });
    assert.match(page.body, /<script src="\/__bodysnatch\/livereload\.js"><\/script><\/head>/);
    assert.equal(Number(page.headers['content-length']), Buffer.byteLength(page.body));

    const message = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: t.port, path: `http://${HOST}/__bodysnatch/events`, headers: { host: HOST } },
        (res) => {
          res.on('data', (c) => {
            const text = String(c);
            if (text.startsWith('data:')) {
              req.destroy();
              resolve(text);
            } else t.proxy.notifyFilesChanged(['a.css']);
          });
        },
      );
      req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
      req.end();
    });
    assert.match(message, /"type":"css"/);
  } finally {
    await t.close();
  }
});
