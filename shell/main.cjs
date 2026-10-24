'use strict';
/**
 * BodySnatch Desktop — оболочка Electron (Windows и macOS).
 *
 * Движок (прокси, PAC, сертификат) работает в отдельном процессе (shell/engine-worker.cjs).
 * Интерфейс грузится по протоколу app://, а его вызовы API идут движку через IPC —
 * без сетевого порта, поэтому до API не дотянется ни одна веб-страница.
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, screen, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createEngineHost } = require('./engine-host.cjs');

const ROOT = path.resolve(__dirname, '..');
const DEV = process.argv.includes('--dev') || process.env.BODYSNATCH_DEV === '1';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
/** --ui <url>: интерфейс с dev-сервера Vite (горячая перезагрузка). */
const UI_OVERRIDE = argValue('--ui');

// одна и та же папка данных для приложения и для `npm start`
app.setName('BodySnatch');
app.setPath('userData', path.join(app.getPath('appData'), 'BodySnatch'));
const DATA = app.getPath('userData');
const LOG = path.join(DATA, 'shell.log');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function log(message) {
  const line = new Date().toISOString() + ' ' + message;
  if (DEV) console.log(line);
  try {
    fs.mkdirSync(DATA, { recursive: true });
    // журнал не растёт бесконечно: при переполнении начинаем заново
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 512 * 1024) fs.renameSync(LOG, LOG + '.old');
    fs.appendFileSync(LOG, line + '\n');
  } catch {
    /* журнал не обязателен */
  }
}

let host = null;
let win = null;
let tray = null;
let configured = false;
let quitting = false;

// ── движок в отдельном процессе ──────────────────────────────────────────────
/** Корневой CA прошлых версий лежал в %LOCALAPPDATA%: берём его, чтобы не потерять установленное доверие. */
function migrateLegacyCA(certsDir) {
  const legacy = path.join(process.env.LOCALAPPDATA || '', 'BodySnatch', 'certs');
  try {
    if (!process.env.LOCALAPPDATA || fs.existsSync(path.join(certsDir, 'rootCA.pem'))) return;
    if (!fs.existsSync(path.join(legacy, 'rootCA.pem')) || !fs.existsSync(path.join(legacy, 'rootCA.key.pem'))) return;
    fs.mkdirSync(certsDir, { recursive: true });
    for (const name of ['rootCA.pem', 'rootCA.key.pem'])
      fs.copyFileSync(path.join(legacy, name), path.join(certsDir, name));
    log('корневой CA перенесён из ' + legacy);
  } catch (e) {
    log('перенос CA: ' + e.message);
  }
}

async function startEngine() {
  migrateLegacyCA(path.join(DATA, 'certs'));
  const dev = path.join(ROOT, 'config', 'rules.user.json');
  host = createEngineHost({
    log,
    getWindow: () => win,
    onQuit: () => void quitApp(),
    // системные настройки вернёт следующий запуск; PAC без живого прокси даёт DIRECT
    onCrash: () => {
      if (quitting) return;
      dialog.showErrorBox('BodySnatch', 'Процесс движка неожиданно завершился. Запустите приложение снова.');
      app.exit(1);
    },
  });
  const info = await host.start(
    {
      configPath: !app.isPackaged && fs.existsSync(dev) ? dev : path.join(DATA, 'rules.json'),
      defaultConfigPath: path.join(ROOT, 'config', 'rules.default.json'),
      stateDir: DATA,
      certsDir: path.join(DATA, 'certs'),
      version: app.getVersion(),
      port: Number(process.env.BODYSNATCH_PORT) || 0,
    },
    UI_OVERRIDE ? { port: 8181, origin: new URL(UI_OVERRIDE).origin } : null,
  );
  log(`движок запущен: прокси 127.0.0.1:${info.port}, PAC ${info.pacUrl}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Статика интерфейса отдаётся прямо из основного процесса. */
function serveStatic(pathname) {
  const dist = path.join(ROOT, 'ui', 'dist');
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
  } catch {
    return new Response('', { status: 400 });
  }
  const abs = path.resolve(dist, rel);
  const inside = abs.startsWith(dist + path.sep);
  const file = inside && fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(dist, 'index.html');
  return new Response(fs.readFileSync(file), {
    headers: {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    },
  });
}

/** Протокол app://: статика интерфейса и вызовы API к движку. */
function registerAppProtocol() {
  const encoder = new TextEncoder();
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname);

    if (url.pathname === '/api/events') {
      let unsubscribe = () => {};
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(': ok\n\n'));
          unsubscribe = host.subscribe((m) => {
            try {
              controller.enqueue(encoder.encode(`event: ${m.event}\ndata: ${JSON.stringify(m.data)}\n\n`));
            } catch {
              /* читатель закрыт */
            }
          });
        },
        cancel: () => unsubscribe(),
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
    }

    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await request.json();
      } catch {
        /* пустое тело */
      }
    }
    const r = await host.api(request.method, url.pathname + url.search, body);
    if (r.json !== undefined) {
      return new Response(JSON.stringify(r.json), {
        status: r.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    return new Response(r.body, { status: r.status, headers: r.headers });
  });
}

// ── окно ────────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 600,
    minHeight: 200,
    show: false,
    title: 'BodySnatch',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#00000000',
    ...(IS_MAC
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 14, y: 14 },
          vibrancy: 'under-window',
          visualEffectState: 'active',
        }
      : { frame: false }),
    ...(IS_WIN ? { backgroundMaterial: 'acrylic' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();

  let uiUrl = UI_OVERRIDE || 'app://bodysnatch/index.html';
  if (process.env.BODYSNATCH_SCREEN)
    uiUrl += (uiUrl.includes('?') ? '&' : '?') + 'screen=' + encodeURIComponent(process.env.BODYSNATCH_SCREEN);
  void win.loadURL(uiUrl);

  win.once('ready-to-show', () => {
    win.show();
    if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  });
  // F12 и Ctrl/Cmd+Shift+I: меню у окна нет, поэтому вешаем обработчик сами
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const toggle =
      input.key === 'F12' || ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
    if (!toggle) return;
    win.webContents.toggleDevTools();
    event.preventDefault();
  });
  // интерфейс не уходит со своей страницы; внешние ссылки открываются в браузере
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://') && !(UI_OVERRIDE && url.startsWith(UI_OVERRIDE))) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (configured) hideToTray();
    else void quitApp();
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function hideToTray() {
  if (!win) return;
  win.hide();
  ensureTray();
}

function ensureTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(path.join(__dirname, 'tray.png')).resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('BodySnatch');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Остановить и выйти', click: () => void quitApp() },
    ]),
  );
  tray.on('click', () => showWindow());
}

/** Вернуть системные настройки и закрыть всё. */
async function quitApp() {
  if (quitting) return;
  quitting = true;
  try {
    // движок сам возвращает системные настройки; ждём, но не бесконечно
    if (host) await host.stop();
  } catch (e) {
    log('выход: ' + e.message);
  }
  tray?.destroy();
  tray = null;
  app.exit(0);
}

/**
 * Размер окна под текущий шаг. Меняется сразу, без анимации: плавность даёт сама страница
 * (раскрытие блоков на CSS), а окно лишь заранее освобождает или подтягивает место.
 */
function applyResize(width, height) {
  if (!win) return;
  const [currentWidth] = win.getContentSize();
  const w = width > 0 ? width : currentWidth;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const h = Math.min(height, area.height);
  win.setMinimumSize(w, Math.min(h, 200));
  win.setContentSize(w, h);
}

ipcMain.on('bs', (event, msg) => {
  if (!msg || typeof msg !== 'object' || !win || event.sender !== win.webContents) return;
  if (msg.bs === 'step' && (msg.step === 'run' || msg.step === 'work')) configured = true;
  switch (msg.bs) {
    case 'minimize':
      win.minimize();
      break;
    case 'close':
      if (configured) hideToTray();
      else void quitApp();
      break;
    case 'resize':
      applyResize(Number(msg.w) || 0, Number(msg.h) || 0);
      break;
    default:
      break;
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    log(`запуск ${app.getVersion()} (${process.platform}/${process.arch})`);
    try {
      await startEngine();
    } catch (e) {
      log('движок не запустился: ' + (e && e.stack ? e.stack : e));
      dialog.showErrorBox('BodySnatch не запустился', String((e && e.message) || e));
      app.exit(3);
      return;
    }
    registerAppProtocol();
    if (IS_MAC) {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
      );
    }
    createWindow();
  });

  // на macOS закрытие окна не завершает приложение; клик по значку в Dock возвращает окно
  app.on('window-all-closed', () => {
    if (!IS_MAC && !quitting) void quitApp();
  });
  app.on('activate', () => showWindow());
  // Cmd+Q и «Завершить» из Dock идут через before-quit: сначала возвращаем системные настройки
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    void quitApp();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void quitApp());
}
