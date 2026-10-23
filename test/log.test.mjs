/**
 * Журнал подмен: записи не должны пропадать сами по себе, и должна быть очистка.
 *
 *   node test/log.test.mjs
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
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const tmp = path.join(os.tmpdir(), 'bs-log-' + Date.now());
fs.mkdirSync(path.join(tmp, 'Telephony_online', '_call'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'Telephony_online', '_call', 'Page.js'), '// локально', 'utf8');

const config = loadConfig(path.join(ROOT, 'config', 'rules.json'));
config.roots = [tmp];
config.moduleRoots = { Telephony_online: tmp };
config.servicePrefixes = ['static/resources'];

const ca = ensureCA(path.join(os.tmpdir(), 'bs-log-ca-' + Date.now()));
const ref = { api: null };
const proxy = createProxy({ config, ca, api: (req, res) => ref.api(req, res), log: () => {} });
ref.api = makeApi({ config, ca, proxy, certsDir: tmp, snapshot: null, distDir: path.join(ROOT, 'ui', 'dist') });
const addr = await proxy.listen(0);
config.port = addr.port;
const base = `http://127.0.0.1:${addr.port}`;

const url = 'https://fix-cdn.sbis.ru/static/resources/Telephony_online/_call/Page.js?x_module=1';
const getOnce = () =>
  new Promise((resolve) => {
    const child = spawn(
      'C:\\Windows\\System32\\curl.exe',
      [
        '-sS',
        '--max-time',
        '30',
        '--ssl-no-revoke',
        '-x',
        `http://127.0.0.1:${addr.port}`,
        '--cacert',
        ca.certPath,
        '-o',
        'NUL',
        url,
      ],
      { windowsHide: true },
    );
    child.on('close', resolve);
  });

await getOnce();
await new Promise((r) => setTimeout(r, 300));
let log = (await (await fetch(`${base}/api/log?n=50`)).json()).log;
check(
  'подмена попала в журнал',
  log.some((e) => String(e.via).startsWith('mirror')),
  `${log.length} записей`,
);
check(
  'в записи есть модуль и путь',
  log.some((e) => e.module === 'Telephony_online' && /Page\.js$/.test(e.file || '')),
);

// повторный опрос не должен обнулять журнал
const again = (await (await fetch(`${base}/api/log?n=50`)).json()).log;
check('повторный опрос не очищает журнал', again.length >= log.length, `${log.length} → ${again.length}`);

// очистка
const cleared = await (await fetch(`${base}/api/log/clear`, { method: 'POST' })).json();
check('очистка вернула ok', cleared.ok === true);
const empty = (await (await fetch(`${base}/api/log?n=50`)).json()).log;
check('после очистки журнал пуст', empty.length === 0, `${empty.length} записей`);

// новые запросы снова пишутся
await getOnce();
await new Promise((r) => setTimeout(r, 300));
const fresh = (await (await fetch(`${base}/api/log?n=50`)).json()).log;
check(
  'после очистки новые записи появляются',
  fresh.some((e) => e.via === 'mirror'),
  `${fresh.length} записей`,
);

await proxy.close();
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
