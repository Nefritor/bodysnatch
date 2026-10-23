/**
 * Настоящий браузер через MITM-прокси: Chrome открывает файл с CDN
 * и должен получить локальную версию (в ней «kekw»).
 *
 *   node test/browser.test.mjs
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
const CERTS = path.join(os.tmpdir(), 'bodysnatch-browser-certs-' + Date.now());
const CHROME_PORT = 9411;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const config = loadConfig(CONFIG);
const ca = ensureCA(CERTS);
const lines = [];
const proxy = createProxy({ config, ca, log: (l) => lines.push(l) });
const addr = await proxy.listen(0);
const proxyUrl = `http://127.0.0.1:${addr.port}`;

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
].find((p) => fs.existsSync(p));
const profile = path.join(os.tmpdir(), `bs-browser-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
const browser = spawn(
  chrome,
  [
    `--user-data-dir=${profile}`,
    `--proxy-server=${proxyUrl}`,
    '--remote-debugging-port=' + CHROME_PORT,
    '--ignore-certificate-errors',
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
await sleep(6000);
const ev = async (expr) =>
  (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true }))?.result?.value;
const text = String((await ev('document.body ? document.body.innerText : ""')) || '');

check('браузер получил локальный файл', text.includes('kekw'), `символов: ${text.length}`);
check(
  'в журнале прокси есть mirror',
  lines.some((l) => l.startsWith('mirror 200')),
  lines.slice(0, 3).join(' | '),
);

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);

browser.kill();
await proxy.close();
try {
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}
process.exitCode = passed === results.length ? 0 : 1;
