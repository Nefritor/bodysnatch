/**
 * Сторож: если хост исчез, прокси обязан выключиться и вернуть системные
 * настройки — иначе браузеры уходят в никуда.
 *
 *   node test/watchdog.test.mjs
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getSystemProxy } from '../proxy/src/sysproxy.mjs';

const ROOT = path.resolve('.');
const PORT = 8193;
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// начинаем с чистого состояния
{
  const { execFileSync } = await import('node:child_process');
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  execFileSync(
    'C:\\Windows\\System32\\reg.exe',
    ['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'],
    { stdio: 'ignore' },
  );
  for (const v of ['ProxyServer', 'ProxyOverride']) {
    try {
      execFileSync('C:\\Windows\\System32\\reg.exe', ['delete', key, '/v', v, '/f'], { stdio: 'ignore' });
    } catch {}
  }
}
const before = getSystemProxy();
const alive = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/state`, { signal: AbortSignal.timeout(1200) });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
};

// «хост», за которым следит прокси: живёт, пока мы его не убьём
const host = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });

const proxy = spawn(
  process.execPath,
  ['proxy/src/main.mjs', '--port', String(PORT), '--watch-parent', String(host.pid)],
  {
    cwd: ROOT,
    stdio: 'ignore',
  },
);

let state = null;
for (let i = 0; i < 40 && !state; i += 1) {
  await sleep(400);
  state = await alive();
}
check('прокси запустился', !!state);

const on = await fetch(`http://127.0.0.1:${PORT}/api/proxy/on`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
}).then((r) => r.json());
check('прокси включён', on.ok === true && getSystemProxy().enabled === true, JSON.stringify(getSystemProxy()));

// убиваем «хост» — прокси должен это заметить
host.kill();

let stopped = false;
for (let i = 0; i < 40; i += 1) {
  await sleep(400);
  if ((await alive()) === null) {
    stopped = true;
    break;
  }
}
check('после смерти хоста прокси остановился', stopped);

let cleaned = false;
for (let i = 0; i < 25; i += 1) {
  await sleep(400);
  const cur = getSystemProxy();
  if (!cur.enabled || !/^127\.0\.0\.1:/.test(cur.server)) {
    cleaned = true;
    break;
  }
}
check('системный прокси возвращён', cleaned, JSON.stringify(getSystemProxy()));

try {
  proxy.kill();
} catch {}
try {
  host.kill();
} catch {}

// страховка: вернуть ровно то, что было до теста
if (!before.enabled) {
  const { execFileSync } = await import('node:child_process');
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  execFileSync(
    'C:\\Windows\\System32\\reg.exe',
    ['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'],
    { stdio: 'ignore' },
  );
  for (const v of ['ProxyServer', 'ProxyOverride']) {
    try {
      execFileSync('C:\\Windows\\System32\\reg.exe', ['delete', key, '/v', v, '/f'], { stdio: 'ignore' });
    } catch {}
  }
}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
