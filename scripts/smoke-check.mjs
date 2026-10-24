/**
 * Проверка запущенного приложения по DevTools-порту (для CI на macOS и локально):
 *   node scripts/smoke-check.mjs [порт]
 * Печатает, что видно в окне, и ответ API движка. Код выхода 1, если окна или движка нет.
 */
const port = Number(process.argv[2]) || 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page = null;
for (let i = 0; i < 40 && !page; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    page = list.find((t) => t.type === 'page');
  } catch {
    /* приложение ещё поднимается */
  }
  if (!page) await sleep(500);
}
if (!page) {
  console.log('ОКНА НЕТ: DevTools-порт не ответил или страницы нет');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const send = (method, params) =>
  new Promise((res) => {
    const id = ++n;
    const h = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === id) {
        ws.removeEventListener('message', h);
        res(m.result);
      }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

await sleep(1500);
console.log('страница:', page.url);
console.log('bs.platform:', await ev('window.bs && window.bs.platform'));
console.log('текст в окне:', JSON.stringify(String(await ev('document.body.innerText')).slice(0, 240)));
const state = await ev(
  "fetch('/api/state').then(r => r.json()).then(s => JSON.stringify({ ok: s.ok, platform: s.platform, port: s.port, trusted: s.cert && s.cert.trusted, pac: s.pacUrl }))",
);
console.log('состояние движка:', state);
process.exit(state ? 0 : 1);
