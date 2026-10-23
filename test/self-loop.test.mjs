/**
 * Регресс: после включения системного прокси браузер может присылать запросы
 * к нашему же интерфейсу через наш прокси. Это не должно уходить в рекурсию.
 *
 *   node test/self-loop.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../proxy/src/config.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';
import { makeApi } from '../proxy/src/api.mjs';

const ROOT = path.resolve('.');
const CERTS = path.join(os.tmpdir(), 'bs-loop-certs-' + Date.now());
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const config = loadConfig(path.join(ROOT, 'config', 'rules.json'));
const ca = ensureCA(CERTS);
const ref = { api: null };
const proxy = createProxy({ config, ca, api: (req, res) => ref.api(req, res), log: () => {} });
ref.api = makeApi({ config, ca, proxy, certsDir: CERTS, snapshot: null, distDir: path.join(ROOT, 'ui', 'dist') });
const addr = await proxy.listen(0);
config.port = addr.port;
const base = `http://127.0.0.1:${addr.port}`;

const curl = (args) =>
  new Promise((resolve) => {
    const child = spawn('C:\\Windows\\System32\\curl.exe', ['-sS', '--max-time', '10', ...args], { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (status) => resolve({ status, out, err }));
  });

// 1) обычный (непрокси) запрос к API
const direct = await curl([`${base}/api/state`]);
check('API напрямую', direct.out.includes('"ok"'), `${direct.out.length} байт`);

// 2) тот же запрос, но отправленный ЧЕРЕЗ наш прокси (так бывает после включения системного прокси)
const viaProxy = await curl(['-x', base, `${base}/api/state`]);
check(
  'API через прокси не уходит в рекурсию',
  viaProxy.out.includes('"ok"'),
  `статус ${viaProxy.status}, ${viaProxy.out.length} байт: ${viaProxy.err.slice(0, 80)}`,
);

// 3) интерфейс через прокси
const page = await curl(['-x', base, `${base}/`]);
check('интерфейс через прокси отдаётся', page.out.includes('id="root"'), `${page.out.length} байт`);

// 4) включение системного прокси отвечает быстро (не висит на PowerShell/WinINET)
const t0 = Date.now();
const on = await fetch(`${base}/api/proxy/on`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(15000),
});
const onBody = await on.text();
const ms = Date.now() - t0;
check('включение прокси отвечает быстро', on.ok && ms < 8000, `${ms} мс, ${onBody.slice(0, 80)}`);
const off = await fetch(`${base}/api/proxy/off`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(15000),
});
check('выключение прокси отвечает', off.ok);

// 5) диагностика прав на изменение прокси
const diag = await (await fetch(`${base}/api/proxy/diagnose`)).json();
check(
  'диагностика отвечает',
  typeof diag.writable === 'boolean',
  `запись: ${diag.writable}, elevated: ${diag.elevated}`,
);

// 6) починка прав (на здоровой машине — безвредна, ключ уже доступен)
const rep = await (
  await fetch(`${base}/api/proxy/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(20000),
  })
).json();
check('починка прав отвечает', typeof rep.ok === 'boolean', `ok=${rep.ok}, выдано: ${(rep.repaired || []).length}`);

// уборка: починка могла включить прокси — возвращаем как было
await fetch(`${base}/api/proxy/off`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
}).catch(() => {});

await proxy.close();
try {
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
