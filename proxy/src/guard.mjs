/**
 * Сторож системного прокси.
 *
 * Запускается отдельным процессом, живёт независимо от приложения и нужен
 * ровно для одного случая: приложение закрыли принудительно (диспетчер задач,
 * падение, «завершить дерево процессов»), настройка прокси осталась включённой,
 * а слушать порт уже некому — браузеры получают ERR_PROXY_CONNECTION_FAILED.
 *
 *   node proxy/src/guard.mjs --port 8180 [--parent <pid>]
 *
 * Как только порт перестал отвечать — выключаем системный прокси (только если
 * он указывает именно на наш порт) и выходим.
 */
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as sysproxy from './sysproxy.mjs';

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : fallback;
};

const port = Number(arg('port', '0'));
const parentPid = Number(arg('parent', '0'));
// --once: разовая проверка при входе в систему. Нужна потому, что при крахе
// системы (BSOD, отключение питания) умирает и сторож, а настройка прокси
// остаётся в реестре — браузер получает ERR_PROXY_CONNECTION_FAILED.
const once = process.argv.includes('--once');
// --heal-now: снять настройку сразу, не дожидаясь смерти порта. Нужен при
// штатном закрытии: окно закрывается мгновенно, а прокси в системе
// выключается параллельно, вне UI-потока приложения.
const healNow = process.argv.includes('--heal-now');
if (!port) process.exit(0);

// журнал кладём рядом с приложением, а не в текущий каталог: при автозапуске
// рабочий каталог бывает системным
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const logFile = path.join(ROOT, 'data', 'proxy-guard.log');
const log = (message) => {
  try {
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + message + '\n');
  } catch {
    /* журнал не обязателен */
  }
};

/** Порт слушается? */
const probe = () =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (alive) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

/** Родитель (процесс прокси) ещё жив? */
const parentAlive = () => {
  if (!parentPid) return false;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Порт мёртв, но системный прокси наш — выключаем. */
const heal = () => {
  const state = sysproxy.snapshot();
  const pointsToUs = String(state.server || '').includes(':' + port);
  if (state.enabled && pointsToUs) {
    const r = sysproxy.restore({ enabled: false, server: '', override: '' }, port);
    log('порт ' + port + ' не отвечает — системный прокси выключен: ' + JSON.stringify(r));
  } else {
    log('порт ' + port + ' не отвечает, но системный прокси не наш (' + JSON.stringify(state) + ') — не трогаю');
  }
};

if (healNow) {
  // штатное закрытие приложения: снимаем настройку, не дожидаясь, пока
  // порт перестанет отвечать
  heal();
  process.exit(0);
}

if (once) {
  // при входе в систему прокси мог подняться не сразу — даём ему шанс
  let alive = false;
  for (let i = 0; i < 5; i += 1) {
    alive = await probe();
    if (alive) break;
    await sleep(1500);
  }
  if (!alive) heal();
  process.exit(0);
}

let misses = 0;
for (;;) {
  await sleep(2000);

  if (await probe()) {
    misses = 0;
    continue;
  }

  misses += 1;
  // ждём две подряд неудачи, чтобы не сработать на коротком рестарте
  if (misses < 2) continue;

  heal();
  process.exit(0);
}
