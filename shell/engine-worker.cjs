'use strict';
/**
 * Процесс движка (Electron utilityProcess): прокси, PAC, правила, сертификат.
 *
 * Тяжёлая работа с сокетами и подписью сертификатов идёт здесь, поэтому интерфейс
 * не подвисает, а падение движка не уносит окно. Всё, что умеет только основной
 * процесс (safeStorage, диалоги, shell), запрашивается у него через rpc().
 *
 * Протокол сообщений описан в shell/main.cjs (раздел «движок»).
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const parent = process.parentPort;
const ROOT = path.resolve(__dirname, '..');

let seq = 0;
const pending = new Map();
/** Вызов возможности основного процесса. */
const rpc = (name, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    parent.postMessage({ t: 'rpc', id, name, args });
  });
const log = (message) => parent.postMessage({ t: 'log', message: String(message) });

let engine = null;
let apiServer = null;
const streams = new Map();

/** Buffer → Uint8Array для structured clone, обратно — на стороне получателя. */
const plain = (r) => (r && r.body && Buffer.isBuffer(r.body) ? { ...r, body: new Uint8Array(r.body) } : r);

async function init(opts) {
  const { createEngine } = await import(pathToFileURL(path.join(ROOT, 'proxy', 'src', 'engine.mjs')).href);
  const protector = opts.protector
    ? {
        encrypt: async (s) => Buffer.from(await rpc('encrypt', s)),
        decrypt: (b) => rpc('decrypt', new Uint8Array(b)),
      }
    : null;
  engine = await createEngine({
    ...opts.engine,
    protector,
    log,
    hooks: {
      pickFolder: (title) => rpc('pickFolder', title),
      openPath: (target) => rpc('openPath', target),
      quit: () => parent.postMessage({ t: 'quit' }),
    },
  });
  const port = await engine.start();

  if (opts.devApi) {
    const { createApiServer } = await import(pathToFileURL(path.join(ROOT, 'proxy', 'src', 'httpapi.mjs')).href);
    apiServer = createApiServer(engine, { allowedOrigins: [opts.devApi.origin] });
    log('API для Vite: http://127.0.0.1:' + (await apiServer.listen(opts.devApi.port)));
  }
  return { port, pacUrl: engine.pacUrl() };
}

async function stop() {
  if (apiServer) await apiServer.close();
  if (engine) await engine.stop();
}

parent.on('message', async ({ data: m }) => {
  try {
    switch (m.t) {
      case 'init':
        parent.postMessage({ t: 'ready', ...(await init(m.opts)) });
        break;
      case 'api': {
        const r = await engine.api.handle(m.method, m.url, m.body);
        parent.postMessage({ t: 'res', id: m.id, r: plain(r) });
        break;
      }
      case 'sse-start': {
        const r = await engine.api.handle('GET', '/api/events');
        streams.set(
          m.id,
          r.sse((event, data) => parent.postMessage({ t: 'sse', id: m.id, event, data })),
        );
        break;
      }
      case 'sse-stop':
        streams.get(m.id)?.();
        streams.delete(m.id);
        break;
      case 'stop':
        await stop();
        parent.postMessage({ t: 'res', id: m.id, r: { ok: true } });
        break;
      case 'rpc-res': {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (p) m.error ? p.reject(new Error(m.error)) : p.resolve(m.value);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    const error = String((e && e.stack) || e);
    if (m.t === 'init') parent.postMessage({ t: 'init-error', error });
    else if (m.id) parent.postMessage({ t: 'res', id: m.id, r: { status: 500, json: { ok: false, error } } });
    else log('воркер: ' + error);
  }
});
