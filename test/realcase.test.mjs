/**
 * Реальный кейс без поблажек:
 *   1) ставим наш CA в настоящее хранилище Windows (CurrentUser\Root) — так же,
 *      как это делает мастер установки;
 *   2) запускаем Chrome БЕЗ --ignore-certificate-errors и БЕЗ --cacert;
 *   3) идём через MITM-прокси на реальный HTTPS-CDN и получаем локальный файл.
 *
 * Если Chrome сам доверился сертификату — значит подмена HTTPS работает
 * на реальной машине, а не только в тестовой песочнице.
 *
 *   node test/realcase.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../proxy/src/config.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';
import { isTrusted, thumbprintOf, writeDer, uninstall } from '../proxy/src/certinstall.mjs';
import { runElevated } from '../proxy/src/sysproxy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG = path.resolve(ROOT, '..', 'bodysnatcher', 'baseline', 'rules.working.json');
const CERTS = path.join(os.tmpdir(), 'bs-realcase-' + Date.now());
const CHROME_PORT = 9417;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
].find((p) => fs.existsSync(p));
if (!chrome) {
  console.log('Chrome не найден');
  process.exit(2);
}

const config = loadConfig(CONFIG);
const ca = ensureCA(CERTS);
const thumb = thumbprintOf(ca.certPem);

// 1) ставим CA в настоящее хранилище через привилегированного помощника
//    (в машинное хранилище — его видят все браузеры пользователя)
const der = writeDer(ca.certPem, CERTS);
let installed = false;
try {
  runElevated('cert', { file: der, logPath: path.join(CERTS, 'install.log') });
  installed = isTrusted(ca.certPem);
} catch {}
check('CA установлен в хранилище Windows', installed, thumb);

// 2) прокси
const lines = [];
const proxy = createProxy({ config, ca, log: (l) => lines.push(l) });
const addr = await proxy.listen(0);
const proxyUrl = `http://127.0.0.1:${addr.port}`;

// 3) Chrome БЕЗ --ignore-certificate-errors
const profile = path.join(os.tmpdir(), `bs-realcase-browser-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
const browser = spawn(
  chrome,
  [
    `--user-data-dir=${profile}`,
    `--proxy-server=${proxyUrl}`,
    '--remote-debugging-port=' + CHROME_PORT,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const conn = async (url) => {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m.result ?? m.error);
      pend.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    Promise.race([
      new Promise((res) => {
        const n = ++id;
        pend.set(n, res);
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
      sleep(20000).then(() => undefined),
    ]);
  return { send };
};

let ver = null;
for (let i = 0; i < 60 && !ver; i += 1) {
  await sleep(400);
  try {
    ver = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`)).json();
  } catch {}
}
const cdp = await conn(ver.webSocketDebuggerUrl);
const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
await sleep(1200);
const list = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`)).json();
const page = await conn(list.find((t) => t.id === created.targetId).webSocketDebuggerUrl);
await page.send('Page.enable');
await page.send('Runtime.enable');

const URL1 = 'https://fix-cdn.sbis.ru/static/resources/Telephony_online/_call/Page.js?x_module=test';
await page.send('Page.navigate', { url: URL1 });
await sleep(7000);
const ev = async (expr) =>
  (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;
const body = String((await ev('document.body ? document.body.innerText : ""')) || '');
const title = String((await ev('document.title')) || '');

check(
  'Chrome доверился нашему CA и открыл файл (без ignore-cert)',
  body.includes('kekw'),
  `символов: ${body.length}, title: ${title.slice(0, 40)}`,
);

// уборка
browser.kill();
await proxy.close();
try {
  uninstall(ca.certPem);
} catch {}
try {
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
