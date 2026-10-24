/**
 * Вызов API запущенного приложения из командной строки через DevTools-порт (для CI и отладки):
 *   node scripts/cdp-call.mjs <METHOD> </api/путь> [таймаут_мс] [порт]
 * Печатает ответ в JSON. Код выхода 2, если ответа не было вовремя.
 */
const [method = 'GET', route = '/api/state', timeoutArg, portArg] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg) || 30000;
const port = Number(portArg) || 9333;

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.log('ОКНА НЕТ');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

const expression = `fetch(${JSON.stringify(route)}, { method: ${JSON.stringify(method)}, headers: { 'content-type': 'application/json' }, body: ${
  method === 'GET' ? 'undefined' : JSON.stringify('{}')
} }).then((r) => r.text())`;

const result = await Promise.race([
  new Promise((resolve) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) resolve(m.result?.result?.value ?? JSON.stringify(m.result ?? m));
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  }),
  new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
]);

if (result === null) {
  console.log(`НЕТ ОТВЕТА за ${timeoutMs} мс: ${method} ${route}`);
  process.exit(2);
}
console.log(result);
process.exit(0);
