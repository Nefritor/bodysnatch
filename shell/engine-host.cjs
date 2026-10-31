'use strict';
/**
 * Основной процесс ↔ процесс движка (shell/engine-worker.cjs).
 *
 * Сообщения воркеру: init, api, sse-start, sse-stop, stop.
 * От воркера: ready, init-error, res (ответ на api/stop), sse (событие),
 * rpc (запрос возможности основного процесса), log, quit.
 */
const { dialog, shell, safeStorage, utilityProcess } = require('electron');
const path = require('node:path');

/**
 * @param {object} o
 * @param {(m: string) => void} o.log
 * @param {() => import('electron').BrowserWindow | null} o.getWindow
 * @param {() => void} o.onQuit воркер попросил завершить приложение
 * @param {(code: number | null) => void} o.onCrash воркер упал сам
 */
function createEngineHost({ log, getWindow, onQuit, onCrash, onUpdate, onWindow }) {
  let worker = null;
  let seq = 0;
  const waiting = new Map();
  const streams = new Map();

  /** Что воркер может попросить у основного процесса. */
  const rpcHandlers = {
    encrypt: (text) => safeStorage.encryptStringAsync(text),
    decrypt: async (bytes) => (await safeStorage.decryptStringAsync(Buffer.from(bytes))).result,
    pickFolder: async (title) => {
      const r = await dialog.showOpenDialog(getWindow(), { title, properties: ['openDirectory'] });
      return r.canceled ? '' : r.filePaths[0] || '';
    },
    openPath: (target) => shell.openPath(target),
    update: (action) => onUpdate(action),
    window: (action) => onWindow(action),
  };

  function onMessage(m) {
    switch (m.t) {
      case 'res':
        if (waiting.has(m.id)) {
          const pending = waiting.get(m.id);
          clearTimeout(pending.timer);
          pending.resolve(m.r);
        }
        waiting.delete(m.id);
        break;
      case 'sse':
        streams.get(m.id)?.(m);
        break;
      case 'log':
        log(m.message);
        break;
      case 'quit':
        onQuit();
        break;
      case 'rpc':
        Promise.resolve()
          .then(() => rpcHandlers[m.name](...m.args))
          .then(
            (value) => worker?.postMessage({ t: 'rpc-res', id: m.id, value }),
            (e) => worker?.postMessage({ t: 'rpc-res', id: m.id, error: String((e && e.message) || e) }),
          );
        break;
      default:
        break;
    }
  }

  /** Запрос к воркеру с ответом. */
  function ask(message, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      if (!worker) return reject(new Error('движок не запущен'));
      const id = ++seq;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('движок не ответил'));
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ ...message, id });
      } catch (error) {
        clearTimeout(timer);
        waiting.delete(id);
        reject(error);
      }
      return undefined;
    });
  }

  return {
    /** Запустить воркер и дождаться готовности: { port, pacUrl }. */
    async start(engineOptions, devApi) {
      // Keychain может ждать подтверждения пользователя. Таймаут запуска worker
      // начинается после этого запроса, чтобы не оставлять отвергнутый Promise без обработчика.
      log('проверяем доступность защищённого хранилища ОС');
      const protector = await safeStorage.isAsyncEncryptionAvailable();
      worker = utilityProcess.fork(path.join(__dirname, 'engine-worker.cjs'), [], {
        serviceName: 'BodySnatch engine',
        stdio: 'pipe',
      });
      worker.stdout?.on('data', (c) => log('[engine] ' + String(c).trimEnd()));
      worker.stderr?.on('data', (c) => log('[engine err] ' + String(c).trimEnd()));
      worker.on('exit', (code) => {
        for (const pending of waiting.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('процесс движка завершился'));
        }
        waiting.clear();
        streams.clear();
        worker = null;
        log('движок завершился с кодом ' + code);
        onCrash(code);
      });
      worker.on('message', onMessage);

      const ready = new Promise((resolve, reject) => {
        const child = worker;
        const cleanup = () => {
          clearTimeout(timer);
          child.off('message', onReady);
          child.off('exit', onExit);
        };
        const onReady = (m) => {
          if (m.t !== 'ready' && m.t !== 'init-error') return;
          cleanup();
          if (m.t === 'ready') resolve(m);
          else reject(new Error(m.error));
        };
        const onExit = () => {
          cleanup();
          reject(new Error('движок завершился при запуске'));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('движок не запустился за 30 секунд'));
        }, 30000);
        child.on('message', onReady);
        child.once('exit', onExit);
      });
      worker.postMessage({
        t: 'init',
        opts: { protector, devApi, engine: engineOptions },
      });
      return ready;
    },

    /** Вызов API движка. */
    api: (method, url, body) => ask({ t: 'api', method, url, body }, 300000),

    /** Подписка на события; возвращает отписку. */
    subscribe(listener) {
      const id = ++seq;
      streams.set(id, listener);
      worker.postMessage({ t: 'sse-start', id });
      return () => {
        streams.delete(id);
        worker?.postMessage({ t: 'sse-stop', id });
      };
    },

    /** Остановить движок (он вернёт системные настройки) и убить процесс. */
    async stop() {
      if (!worker) return;
      try {
        await ask({ t: 'stop' }, 150000);
      } finally {
        worker?.kill();
      }
    },
  };
}

module.exports = { createEngineHost };
