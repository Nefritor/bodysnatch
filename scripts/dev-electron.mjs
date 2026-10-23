/**
 * Запуск Electron-оболочки в режиме разработки.
 *
 *   npm run dev:electron
 *
 * Поднимает dev-сервер Vite (горячая перезагрузка интерфейса) и Electron,
 * который грузит интерфейс уже с него. Прокси при этом поднимает сама
 * оболочка, а Vite проксирует /api на его порт — см. vite.config.ts.
 *
 * Полезные варианты:
 *   node scripts/dev-electron.mjs --no-ui     только Electron, без Vite
 *   node scripts/dev-electron.mjs --no-devtools
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const VITE_PORT = 5179;
const NO_UI = process.argv.includes('--no-ui');
const NO_DEVTOOLS = process.argv.includes('--no-devtools');

const log = (m) => console.log('[dev:electron] ' + m);

/** Порт слушается на любом из адресов (Vite слушает localhost — это бывает ::1). */
const probeHosts = ['127.0.0.1', '::1'];

/** Одна проба: принимает ли порт соединения на этом адресе. */
function probeOnce(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** Ждём, пока порт Vite начнёт принимать соединения. */
async function waitForPort(port, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const host of probeHosts) {
      if (await probeOnce(port, host)) return true;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

let vite = null;
let electron = null;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [electron, vite]) {
    try {
      if (child && !child.killed) child.kill();
    } catch {
      /* процесс мог уже выйти */
    }
  }
  process.exit(code);
}

async function main() {
  let uiUrl = null;

  if (!NO_UI) {
    log('запускаю Vite на порту ' + VITE_PORT);
    vite = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(VITE_PORT), '--host', '127.0.0.1'],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env },
      },
    );
    vite.on('exit', (code) => log('Vite завершился с кодом ' + code));

    const ready = await waitForPort(VITE_PORT);
    if (!ready) {
      log('Vite не поднялся — запускаю Electron на собранном интерфейсе');
    } else {
      uiUrl = 'http://127.0.0.1:' + VITE_PORT;
      log('Vite готов: ' + uiUrl);
    }
  }

  const args = [path.join(ROOT, 'shell', 'main.cjs')];
  if (!NO_DEVTOOLS) args.push('--dev');
  if (uiUrl) args.push('--ui', uiUrl);

  log('запускаю Electron');
  // переменную надо именно удалить: пустая строка тоже считается заданной,
  // и Electron запустится как обычный node
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  electron = spawn(require('electron'), args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: childEnv,
  });
  electron.on('exit', (code) => {
    log('Electron завершился с кодом ' + code);
    stop(code ?? 0);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

main().catch((e) => {
  console.error('[dev:electron] ошибка: ' + e.message);
  stop(1);
});
