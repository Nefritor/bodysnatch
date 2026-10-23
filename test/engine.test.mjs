import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createEngine } from '../proxy/src/engine.mjs';
import { createApiServer } from '../proxy/src/httpapi.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { tmpdir } from './helpers.mjs';

/** Платформа в памяти: системный прокси и хранилище сертификатов не трогаются. */
function fakePlatform(initial = { pacUrl: '', manual: { enabled: false, server: '' } }) {
  const p = {
    id: 'fake',
    system: structuredClone(initial),
    trusted: false,
    calls: [],
    proxyState: async () => structuredClone(p.system),
    setPac: async (url) => {
      p.calls.push(['setPac', url]);
      p.system.pacUrl = url;
    },
    restoreProxy: async (prev) => {
      p.calls.push(['restore', prev]);
      p.system.pacUrl = prev ? prev.pacUrl : '';
    },
    openProxySettings: async () => {},
    certTrusted: async () => p.trusted,
    certInstall: async () => ((p.trusted = true), { ok: true }),
    certUninstall: async () => ((p.trusted = false), { ok: true }),
  };
  return p;
}

async function boot(platform = fakePlatform(), over = {}) {
  const dir = tmpdir('engine');
  const engine = await createEngine({
    configPath: path.join(dir, 'rules.json'),
    stateDir: dir,
    certsDir: path.join(dir, 'certs'),
    platform,
    port: 0,
    hooks: {},
    ...over,
  });
  await engine.start();
  return { engine, dir, platform };
}

test('включение PAC сохраняет прежнее состояние и возвращает его при выключении', async () => {
  const platform = fakePlatform({ pacUrl: 'http://corp/pac', manual: { enabled: false, server: '' } });
  const { engine } = await boot(platform);
  try {
    await engine.enableSystemProxy();
    assert.match(platform.system.pacUrl, /^http:\/\/127\.0\.0\.1:\d+\/proxy\.pac\?v=/);
    const state = (await engine.api.handle('GET', '/api/state')).json;
    assert.equal(state.systemProxy.ours, true);

    await engine.disableSystemProxy();
    assert.equal(platform.system.pacUrl, 'http://corp/pac');
  } finally {
    await engine.stop();
  }
});

test('после аварии наш PAC снимается при следующем запуске', async () => {
  const platform = fakePlatform();
  const dir = tmpdir('crash');
  const opts = { configPath: path.join(dir, 'rules.json'), stateDir: dir, certsDir: path.join(dir, 'certs'), platform, port: 0 };
  const first = await createEngine(opts);
  await first.start();
  await first.enableSystemProxy();
  assert.ok(platform.system.pacUrl);
  // «убитый» процесс: stop() не вызывается, просто закрываем сокет
  await first.proxy.close();

  const second = await createEngine(opts);
  await second.start();
  try {
    assert.equal(platform.system.pacUrl, '', 'PAC от упавшего запуска убран');
  } finally {
    await second.stop();
  }
});

test('корпоративный прокси из системы становится запасным маршрутом PAC и upstream', async () => {
  const platform = fakePlatform({ pacUrl: '', manual: { enabled: true, server: 'http=corp:3128;https=corp:3129' } });
  const { engine } = await boot(platform);
  try {
    await engine.enableSystemProxy();
    assert.equal(engine.effectiveUpstream(), 'corp:3129');
    assert.match(engine.pacText(), /PROXY corp:3129; DIRECT/);
  } finally {
    await engine.stop();
  }
});

test('смена маски меняет PAC и перезаписывает системную настройку', async () => {
  const platform = fakePlatform();
  const { engine } = await boot(platform);
  try {
    await engine.enableSystemProxy();
    const before = platform.system.pacUrl;
    const config = { sites: [{ id: 'site', enabled: true, match: ['https://new.example.test'] }] };
    const r = await engine.api.handle('POST', '/api/config', { config });
    assert.equal(r.json.ok, true);
    assert.notEqual(platform.system.pacUrl, before);
    assert.match(engine.pacText(), /new\.example\.test/);
    assert.ok(fs.existsSync(engine.config.__path), 'конфиг записан на диск');
  } finally {
    await engine.stop();
  }
});

test('сертификат: установка и проверка идут через платформу', async () => {
  const platform = fakePlatform();
  const { engine } = await boot(platform);
  try {
    assert.equal((await engine.api.handle('GET', '/api/state')).json.cert.trusted, false);
    const r = await engine.api.handle('POST', '/api/cert/install');
    assert.equal(r.json.trusted, true);
  } finally {
    await engine.stop();
  }
});

test('ключ CA шифруется protector-ом и не лежит на диске открытым', () => {
  const dir = tmpdir('protect');
  const protector = {
    encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
    decrypt: (b) => Buffer.from(b).reverse().toString('utf8'),
  };
  const first = ensureCA(dir, { protector });
  assert.equal(fs.existsSync(path.join(dir, 'rootCA.key.pem')), false);
  assert.equal(fs.existsSync(path.join(dir, 'rootCA.key.enc')), true);
  const again = ensureCA(dir, { protector });
  assert.equal(again.created, false);
  assert.equal(again.certPem, first.certPem);
});

test('старый открытый ключ переводится в защищённый вид', () => {
  const dir = tmpdir('migrate');
  ensureCA(dir); // без protector: PEM-файл
  assert.equal(fs.existsSync(path.join(dir, 'rootCA.key.pem')), true);
  const protector = { encrypt: (s) => Buffer.from(s), decrypt: (b) => String(b) };
  ensureCA(dir, { protector });
  assert.equal(fs.existsSync(path.join(dir, 'rootCA.key.pem')), false);
  assert.equal(fs.existsSync(path.join(dir, 'rootCA.key.enc')), true);
});

test('HTTP-API принимает только свой origin и loopback-Host', async () => {
  const { engine } = await boot();
  const api = createApiServer(engine, { allowedOrigins: ['http://localhost:5179'] });
  const port = await api.listen(0);
  const call = (headers, method = 'GET', url = '/api/state') =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.end();
    });
  try {
    assert.equal(await call({}), 200);
    assert.equal(await call({ origin: `http://127.0.0.1:${port}` }), 200);
    assert.equal(await call({ origin: 'http://localhost:5179' }), 200);
    assert.equal(await call({ origin: 'https://evil.example' }, 'POST', '/api/proxy/off'), 403);
    assert.equal(await call({ host: 'evil.example' }), 403, 'DNS rebinding');
    assert.equal(await call({ 'sec-fetch-site': 'cross-site' }), 403);
  } finally {
    await api.close();
    await engine.stop();
  }
});

test('прокси больше не отдаёт API: на его порту только PAC', async () => {
  const { engine } = await boot();
  try {
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: engine.port, path: '/api/state' }, (res) => (res.resume(), resolve(res.statusCode)));
    });
    assert.equal(status, 404);
  } finally {
    await engine.stop();
  }
});
