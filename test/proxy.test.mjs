/**
 * Проверка MITM-прокси на РЕАЛЬНЫХ примерах (настоящий CDN sbis.ru + локальные файлы).
 *
 *   node test/proxy.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../proxy/src/config.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG = path.resolve(ROOT, '..', 'bodysnatcher', 'baseline', 'rules.working.json');
const CERTS = path.join(os.tmpdir(), 'bodysnatch-test-certs-' + Date.now());

const curlBin = ['C:\\Windows\\System32\\curl.exe', 'curl'].find((p) => p === 'curl' || fs.existsSync(p));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const config = loadConfig(CONFIG);
const ca = ensureCA(CERTS);
const lines = [];
const proxy = createProxy({ config, ca, log: (l) => lines.push(l) });
const addr = await proxy.listen(0);
const proxyUrl = `http://127.0.0.1:${addr.port}`;

/** curl через прокси; системный schannel-curl требует --ssl-no-revoke для своего CA. */
let seq = 0;
const get = (url) =>
  new Promise((resolve) => {
    const n = ++seq;
    const headFile = path.join(CERTS, `h${n}.txt`);
    const bodyFile = path.join(CERTS, `b${n}.bin`);
    const child = spawn(
      curlBin,
      [
        '-sS',
        '--max-time',
        '30',
        '--ssl-no-revoke',
        '-x',
        proxyUrl,
        '--cacert',
        ca.certPath,
        '-D',
        headFile,
        '-o',
        bodyFile,
        url,
      ],
      { windowsHide: true },
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (status) => {
      const head = fs.existsSync(headFile) ? fs.readFileSync(headFile, 'utf8') : '';
      const body = fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : '';
      const headers = {};
      // берём последний блок заголовков (первый — ответ на CONNECT)
      const blocks = head.split(/\r?\n\r?\n/).filter(Boolean);
      for (const line of (blocks[blocks.length - 1] || '').split(/\r?\n/).slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({ status, headers, body, err });
    });
  });

const ONLINE = 'https://fix-cdn.sbis.ru/static/resources/Telephony_online/_call/Page.js?x_module=test';

// 1) подмена: локальный файл из F:\test\application
const a = await get(ONLINE);
check(
  'HTTPS: Telephony_online/Page.js отдан локальный',
  a.body.includes('kekw'),
  `curl=${a.status}, откуда=${a.headers['x-bodysnatch'] || 'сеть'}`,
);
check(
  'заголовок источника — mirror',
  String(a.headers['x-bodysnatch'] || '').startsWith('mirror'),
  String(a.headers['x-bodysnatch'] || ''),
);

// 2) минифицированное имя находит обычный файл
const b = await get(ONLINE.replace('Page.js', 'Page.min.js'));
check('.min.js → локальный Page.js', b.body.includes('kekw'), `откуда=${b.headers['x-bodysnatch'] || 'сеть'}`);

// 3) другой модуль из другой папки (F:\test2\application)
const c = await get('https://fix-cdn2.sbis.ru/static/resources/Telephony_utils/_call/Page.js?x_module=test');
check(
  'HTTPS: Telephony_utils отдан из второй папки',
  c.body.includes('kekw'),
  `откуда=${c.headers['x-bodysnatch'] || 'сеть'}`,
);

// 4) модуль не выбран в настройках → запрос уходит на сервер
const d = await get('https://fix-cdn.sbis.ru/static/resources/Telephony_calls/_call/Page.js?x_module=test');
check(
  'невыбранный модуль не подменяется',
  !d.headers['x-bodysnatch'] && !d.body.includes('kekw'),
  `статус=${d.status}, откуда=${d.headers['x-bodysnatch'] || 'сеть'}`,
);

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log('\nжурнал прокси:');
for (const l of lines.slice(0, 6)) console.log('  ' + l);
console.log(`\n${passed}/${results.length} проверок прошло`);

await proxy.close();
try {
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}
process.exitCode = passed === results.length ? 0 : 1;
