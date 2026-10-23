'use strict';
/**
 * BodySnatch Desktop — оболочка на Electron.
 *
 * Повторяет поведение C#-хоста: поднимает прокси, показывает окно без
 * системной шапки, уходит в трей и снимает системный прокси при выходе.
 * Интерфейс грузится прямо с прокси (тот же origin, что и API).
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, shell: electronShell, nativeImage, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const LOG = path.join(DATA, 'shell.log');
const DEV = process.argv.includes('--dev') || process.env.BODYSNATCH_DEV === '1';

/** --ui <url>: грузить интерфейс с dev-сервера Vite (горячая перезагрузка). */
function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const UI_OVERRIDE = argValue('--ui');

function log(message) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(LOG, new Date().toISOString() + ' ' + message + '\n');
  } catch {
    /* журнал не обязателен */
  }
  if (DEV) console.log(message);
}

function readPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'rules.json'), 'utf8'));
    if (Number(cfg.port)) return Number(cfg.port);
  } catch {
    /* порт по умолчанию */
  }
  return 8180;
}

const PORT = Number(process.env.BODYSNATCH_PORT) || readPort();
// Материал окна для сравнения вариантов: none | acrylic | mica | tabbed
const MATERIAL = (process.env.BODYSNATCH_MATERIAL || 'acrylic').toLowerCase();
const USE_MATERIAL = MATERIAL !== 'none';

let win = null;
let tray = null;
let agent = null;
let configured = false;
let dragging = null;
let quitting = false;

/** Прокси запускается этим же файлом Electron в режиме Node. */
function startAgent() {
  const entry = path.join(ROOT, 'proxy', 'src', 'main.mjs');
  if (!fs.existsSync(entry)) {
    log('прокси: не найден ' + entry);
    return false;
  }
  agent = spawn(
    process.execPath,
    [entry, '--port', String(PORT), '--config', path.join(ROOT, 'config', 'rules.json')],
    {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  agent.stdout.on('data', (chunk) => log(String(chunk).trimEnd()));
  agent.stderr.on('data', (chunk) => log('[err] ' + String(chunk).trimEnd()));
  agent.on('exit', (code) => log('прокси завершился с кодом ' + code));
  log('прокси запущен: pid=' + agent.pid + ' порт=' + PORT);
  return true;
}

function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('таймаут')));
    req.on('error', reject);
  });
}

function apiPost(pathname) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: pathname,
        method: 'POST',
        timeout: 800,
        headers: { 'content-type': 'application/json' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(true));
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end('{}');
  });
}

async function waitForApi(timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await apiGet('/api/state');
      if (r.status === 200) return true;
    } catch {
      /* прокси ещё поднимается */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 600,
    minHeight: 200,
    frame: false,
    show: false,
    // прозрачное окно: форму задаёт интерфейс, поэтому ни DWM, ни области
    // не нужны — и артефактов при перерисовке не бывает
    // с системным материалом окно обязано быть непрозрачным; без него
    // работает нативная прозрачность, и всё оформление задаёт CSS
    transparent: !USE_MATERIAL,
    backgroundColor: '#00000000',
    title: 'BodySnatch Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.removeMenu();
  if (USE_MATERIAL) {
    try {
      win.setBackgroundMaterial(MATERIAL);
      log('фон окна: ' + MATERIAL);
    } catch (e) {
      log('фон окна: ' + MATERIAL + ' недоступен — ' + e.message);
    }
  } else {
    log('фон окна: прозрачный, оформление целиком в CSS');
  }
  let uiUrl = UI_OVERRIDE || 'http://127.0.0.1:' + PORT + '/';
  // для скриншотов: BODYSNATCH_SCREEN=work|rules|proxy|cert открывает нужный шаг
  if (process.env.BODYSNATCH_SCREEN) {
    uiUrl += (uiUrl.includes('?') ? '&' : '?') + 'screen=' + encodeURIComponent(process.env.BODYSNATCH_SCREEN);
  }
  win.loadURL(uiUrl);
  log('интерфейс: ' + uiUrl);
  win.once('ready-to-show', () => {
    win.show();
    if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  });
  // F12 и Ctrl+Shift+I: меню у окна нет, поэтому вешаем обработчик сами
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const toggle = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (!toggle) return;
    win.webContents.toggleDevTools();
    event.preventDefault();
  });
  // Для скриншотов: программно открыть меню тем и/или дойти до рабочего экрана
  if (
    process.env.BODYSNATCH_OPEN_THEME === '1' ||
    process.env.BODYSNATCH_ADD_MASK === '1' ||
    Number(process.env.BODYSNATCH_GOTO_WORK || '0') > 0
  ) {
    win.webContents.on('did-finish-load', async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const clickText = (text) =>
        win.webContents.executeJavaScript(
          `(() => {
            const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}));
            if (el) { el.click(); return true; }
            return false;
          })()`,
        );
      try {
        const steps = Number(process.env.BODYSNATCH_GOTO_WORK || '0');
        if (steps > 0) {
          for (let i = 0; i < steps; i += 1) {
            const pressed = await clickText('Далее');
            await wait(1200);
            if (!pressed) break;
          }
          if (steps >= 4) {
            await clickText('Правила подмены');
            await wait(600);
            await clickText('Запросы');
            await wait(600);
          }
          log('шагов пройдено программно: ' + steps);
        }
        if (process.env.BODYSNATCH_ADD_MASK === '1') {
          await wait(1200);
          await win.webContents.executeJavaScript('document.querySelector(\'[title="добавить префикс"]\')?.click()');
          await wait(500);
          log('редактор маски открыт программно');
        }
        if (process.env.BODYSNATCH_OPEN_THEME === '1') {
          await win.webContents.executeJavaScript(
            'document.querySelector(\'[aria-label="Тема оформления"]\')?.click()',
          );
          log('меню тем открыто программно');
        }
      } catch (e) {
        log('сценарий скриншота: ' + e.message);
      }
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    electronShell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (configured) hideToTray();
    else void quitApp();
  });
  log('окно: показано');
}

function hideToTray() {
  if (!win) return;
  win.hide();
  ensureTray(true);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function ensureTray(tip = false) {
  if (!tray) {
    const iconPath = path.join(ROOT, 'host', 'icon.ico');
    const image = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    tray = new Tray(image);
    tray.setToolTip('BodySnatch Desktop');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Открыть', click: () => showWindow() },
        { type: 'separator' },
        {
          label: 'Выход',
          click: () => {
            void quitApp();
          },
        },
      ]),
    );
    tray.on('double-click', () => showWindow());
  }
  if (tip) {
    tray.displayBalloon?.({
      title: 'BodySnatch работает в фоне',
      content: 'Прокси продолжает подменять файлы. Выход — из меню значка.',
    });
  }
}

/** Снять системный прокси сразу, не дожидаясь смерти порта. */
function healProxyNow() {
  try {
    const guard = path.join(ROOT, 'proxy', 'src', 'guard.mjs');
    if (!fs.existsSync(guard)) return;
    spawn(process.execPath, [guard, '--port', String(PORT), '--heal-now'], {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch (e) {
    log('снятие прокси: ' + e.message);
  }
}

async function quitApp() {
  if (quitting) return;
  quitting = true;
  healProxyNow();
  await apiPost('/api/quit');
  try {
    if (tray) tray.destroy();
    tray = null;
  } catch {
    /* значок мог уже исчезнуть */
  }
  app.exit(0);
}

/**
 * Размер окна под текущий шаг. Минимум выставляем равным запрошенному:
 * у мастера и рабочего экрана разная ширина, и общий минимум мешает.
 */
function applyResize(width, height) {
  if (!win) return;
  const [currentWidth] = win.getContentSize();
  const w = width > 0 ? width : currentWidth;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const h = Math.min(height, area.height);
  win.setMinimumSize(w, Math.min(h, 200));
  win.setContentSize(w, h);
  log('resize: ' + w + 'x' + h + ' контент ' + win.getContentSize().join('x'));
}

ipcMain.on('bs-message', (_event, payload) => {
  const msg = typeof payload === 'string' ? safeParse(payload) : payload;
  if (!msg || typeof msg !== 'object') return;
  log('UI → ' + JSON.stringify(msg).slice(0, 160));

  if (msg.step === 'run' || msg.step === 'work') configured = true;

  switch (msg.bs) {
    case 'minimize':
      win?.minimize();
      break;
    case 'close':
      if (configured) hideToTray();
      else void quitApp();
      break;
    case 'resize':
      applyResize(Number(msg.w) || 0, Number(msg.h) || 0);
      break;
    case 'show':
      showWindow();
      break;
    case 'openpath':
      if (typeof msg.path === 'string' && msg.path) electronShell.openPath(msg.path).catch(() => {});
      break;
    case 'drag':
      // перетаскивание делает preload по событиям мыши
      break;
    default:
      break;
  }
});

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

ipcMain.on('bs-drag-start', (_e, point) => {
  if (!win) return;
  const [wx, wy] = win.getPosition();
  dragging = { dx: point.x - wx, dy: point.y - wy };
});

ipcMain.on('bs-drag-move', (_e, point) => {
  if (!win || !dragging) return;
  win.setPosition(Math.round(point.x - dragging.dx), Math.round(point.y - dragging.dy));
});

ipcMain.on('bs-drag-end', () => {
  dragging = null;
});

/** Диагностика из preload. */
ipcMain.on('bs-log', (_e, payload) => log('страница: ' + JSON.stringify(payload)));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    log('запуск оболочки: порт=' + PORT);
    if (!startAgent()) {
      app.exit(3);
      return;
    }
    const ready = await waitForApi(30000);
    log('прокси готов: ' + ready);
    if (!ready) {
      app.exit(4);
      return;
    }
    createWindow();
    ensureTray(false);
  });

  app.on('window-all-closed', () => {
    if (!quitting) void quitApp();
  });

  app.on('before-quit', () => {
    quitting = true;
  });
}
