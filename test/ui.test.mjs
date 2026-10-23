/**
 * UI-смоук: собранный интерфейс открывается в браузере и показывает мастер.
 * Системные настройки не меняются — только чтение.
 *
 *   node test/ui.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../proxy/src/config.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';
import { makeApi } from '../proxy/src/api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG = path.resolve(ROOT, '..', 'bodysnatcher', 'baseline', 'rules.working.json');
const DIST = path.join(ROOT, 'ui', 'dist');
const CERTS = path.join(os.tmpdir(), 'bodysnatch-ui-certs-' + Date.now());
const CHROME_PORT = 9412;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const config = loadConfig(CONFIG);
const ca = ensureCA(CERTS);
const ref = { api: null };
const proxy = createProxy({ config, ca, api: (req, res) => ref.api(req, res) });
ref.api = makeApi({ config, ca, proxy, certsDir: CERTS, snapshot: null, distDir: DIST });
const addr = await proxy.listen(0);
const base = `http://127.0.0.1:${addr.port}`;

const chrome = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
].find((p) => fs.existsSync(p));
const profile = path.join(os.tmpdir(), `bs-ui-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
const browser = spawn(
  chrome,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CHROME_PORT}`,
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
      sleep(15000).then(() => undefined),
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
const created = await cdp.send('Target.createTarget', { url: base + '/' });
await sleep(1200);
const list = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`)).json();
const page = await conn(list.find((t) => t.id === created.targetId).webSocketDebuggerUrl);
await page.send('Runtime.enable');

const ev = async (expr) =>
  (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;

let text = '';
for (let i = 0; i < 20; i += 1) {
  await sleep(500);
  text = String((await ev('document.body ? document.body.innerText : ""')) || '');
  if (text.length > 40) break;
}

check('интерфейс отрисовался', text.length > 40, `${text.length} символов`);
// порядок шагов задаётся в App.tsx, тест его не фиксирует
check('видны шаги мастера', /Сертификат/.test(text) && /Прокси/.test(text) && /Правила/.test(text));
check('первый экран — сертификат', /Сертификат для HTTPS/.test(text), text.split('\n')[0] || '');

// переходим на шаг «Прокси»: сначала «Продолжить без сертификата», иначе «Далее»
const clicked = await ev(`(() => {
  const byText = (re) => [...document.querySelectorAll('button, a')]
    .find((x) => re.test(x.textContent || '') && !x.disabled);
  const next = byText(/Продолжить без сертификата/) || byText(/^\\s*Далее\\s*$/);
  if (!next) return false;
  next.click();
  return true;
})()`);
await sleep(800);
const proxyText = String((await ev('document.body ? document.body.innerText : ""')) || '');
check('переход на шаг «Прокси»', clicked === true && /Системный прокси|Включить прокси|Отключить прокси/.test(proxyText));
check('виден бейдж состояния', /выключен|слушаем/.test(proxyText));
check('видна кнопка включения/отключения прокси', /Включить прокси|Отключить прокси/.test(proxyText));

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\nфрагмент: ${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 160))}`);
console.log(`${passed}/${results.length} проверок прошло`);

browser.kill();
await proxy.close();
try {
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}
process.exitCode = passed === results.length ? 0 : 1;
