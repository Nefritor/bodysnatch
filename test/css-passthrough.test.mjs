/**
 * CSS отдаётся байт в байт — прокси не переписывает url() и @import.
 * Регрессия: раньше содержимое прогонялось через rewriteCssUrls (наследие расширения),
 * и любой сбой регулярки ломал файл. В MITM файл приходит по тому же URL, что и с
 * сервера, поэтому относительные пути разрешаются браузером правильно сами.
 *
 *   node test/css-passthrough.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadConfig } from '../proxy/src/config.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';

const ROOT = path.resolve('.');
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const tmp = path.join(os.tmpdir(), 'bs-css-' + Date.now());
const moduleDir = path.join(tmp, 'Telephony_online', 'css');
fs.mkdirSync(moduleDir, { recursive: true });

const css = [
  '@import "base.css";',
  '.a { background: url(../img/a.png); }',
  '.b { background: url("../img/b c.png"); }',
  ".c { background: url('/abs/c.png'); }",
  '.d { background: url(data:image/png;base64,AAA); }',
  '.e { filter: url(#svgfilter); }',
  '/* комментарий с url(../x.png) — менять нельзя */',
].join('\n');
fs.writeFileSync(path.join(moduleDir, 'Page.css'), css, 'utf8');

const config = loadConfig(path.join(ROOT, 'config', 'rules.json'));
config.roots = [tmp];
config.moduleRoots = { Telephony_online: tmp };
config.servicePrefixes = ['static/resources'];

const ca = ensureCA(path.join(os.tmpdir(), 'bs-css-ca-' + Date.now()));
const lines = [];
const proxy = createProxy({ config, ca, log: (l) => lines.push(l) });
const addr = await proxy.listen(0);
config.port = addr.port;

const url = 'https://fix-cdn.sbis.ru/static/resources/Telephony_online/css/Page.css?x_module=1';
// только асинхронно: синхронный вызов заблокировал бы event loop прокси в этом же процессе
const outFile = path.join(os.tmpdir(), 'bs-css-out-' + Date.now() + '.txt');
let error = '';
await new Promise((resolve) => {
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
      outFile,
      url,
    ],
    { windowsHide: true },
  );
  child.stderr.on('data', (d) => (error += d));
  child.on('close', resolve);
});
const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
try {
  fs.rmSync(outFile, { force: true });
} catch {}

check('CSS получен через прокси', out.length > 0, error || `${out.length} байт`);
check('содержимое совпадает с файлом байт в байт', out === css);
check('относительный url() не переписан', out.includes('url(../img/a.png)'));
check('url() с пробелом в имени не тронут', out.includes('url("../img/b c.png")'));
check('абсолютный url() не тронут', out.includes("url('/abs/c.png')"));
check('data: не тронут', out.includes('url(data:image/png;base64,AAA)'));
check('url(#…) не тронут', out.includes('url(#svgfilter)'));
check('@import не переписан', out.includes('@import "base.css"'));
check(
  'в журнале mirror',
  lines.some((l) => l.startsWith('mirror 200')),
  lines.slice(-2).join(' | '),
);

await proxy.close();
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
