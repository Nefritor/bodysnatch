/**
 * Выключение прокси, в том числе когда помощник записал машинные настройки (HKLM):
 * именно из-за них у пользователя прокси «не выключался».
 *
 *   node test/proxy-off.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../proxy/src/config.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';
import { makeApi } from '../proxy/src/api.mjs';
import { getSystemProxy, getMachineProxy, machineOurs } from '../proxy/src/sysproxy.mjs';

const ROOT = path.resolve('.');
const CERTS = path.join(os.tmpdir(), 'bs-off-' + Date.now());
const HKCU = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const HKLM = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const reg = (args) => {
  try {
    return execFileSync('C:\\Windows\\System32\\reg.exe', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const config = loadConfig(path.join(ROOT, 'config', 'rules.json'));
const ca = ensureCA(CERTS);
const ref = { api: null };
const proxy = createProxy({ config, ca, api: (req, res) => ref.api(req, res), log: () => {} });
ref.api = makeApi({ config, ca, proxy, certsDir: CERTS, snapshot: null, distDir: path.join(ROOT, 'ui', 'dist') });
const addr = await proxy.listen(0);
config.port = addr.port;
const base = `http://127.0.0.1:${addr.port}`;
const post = (p) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(120000),
  }).then((r) => r.json());

// исходное состояние машины
// начинаем с чистого состояния: иначе снимок может содержать наш же прокси
reg(['add', HKCU, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
reg(['delete', HKCU, '/v', 'ProxyServer', '/f']);
reg(['delete', HKCU, '/v', 'ProxyOverride', '/f']);
const startState = getSystemProxy();
const startMachine = getMachineProxy();

// 1) включаем
const on = await post('/api/proxy/on');
check('включение', on.ok === true, JSON.stringify(on.systemProxy));

// 2) имитируем случай пользователя: помощник записал ещё и HKLM
reg(['add', HKLM, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
reg(['add', HKLM, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${addr.port}`, '/f']);
check('HKLM указывает на нас', machineOurs(addr.port), JSON.stringify(getMachineProxy()));

// 3) выключаем — должно убрать и HKCU, и HKLM
const off = await post('/api/proxy/off');
check('выключение вернуло ok', off.ok === true, JSON.stringify({ ok: off.ok, error: off.error }));
check('HKCU выключен', getSystemProxy().enabled === false, JSON.stringify(getSystemProxy()));
check('HKLM очищен', machineOurs(addr.port) === false, JSON.stringify(getMachineProxy()));

// 4) и снова включается
const on2 = await post('/api/proxy/on');
check('повторное включение', on2.ok === true && getSystemProxy().enabled === true, JSON.stringify(on2.systemProxy));
const off2 = await post('/api/proxy/off');
check('повторное выключение', off2.ok === true && getSystemProxy().enabled === false);
check('HKLM снова чист', machineOurs(addr.port) === false);

// возвращаем машину как было
if (!startState.enabled) {
  reg(['add', HKCU, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
  reg(['delete', HKCU, '/v', 'ProxyServer', '/f']);
  reg(['delete', HKCU, '/v', 'ProxyOverride', '/f']);
}
if (!startMachine.enabled) {
  reg(['add', HKLM, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
  reg(['delete', HKLM, '/v', 'ProxyServer', '/f']);
  reg(['delete', HKLM, '/v', 'ProxyOverride', '/f']);
}

await proxy.close();
try {
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
