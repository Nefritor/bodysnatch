'use strict';
/**
 * Мост интерфейса к оболочке Electron.
 *
 * UI написан под WebView2 и зовёт `window.chrome.webview.postMessage(...)`.
 * В Electron с contextIsolation страница живёт в отдельном мире, поэтому:
 *   1) транспорт отдаём через contextBridge;
 *   2) в мир страницы вставляем тонкую совместимую заглушку WebView2.
 *
 * Отдельно — перетаскивание окна: системной шапки нет, а мышью в Electron
 * управляет только renderer.
 */
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('bsBridge', {
  send: (payload) => ipcRenderer.send('bs-message', payload),
});

// совместимость с WebView2 в мире страницы
webFrame
  .executeJavaScript(
    `(() => {
      if (window.chrome && window.chrome.webview) return;
      window.chrome = window.chrome || {};
      window.chrome.webview = {
        postMessage: (payload) => window.bsBridge.send(payload),
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    })()`,
  )
  .catch(() => {});

// ── окно Electron: прозрачность и метка оболочки ───────────────────────────
// Фон и скругление задаёт общий theme.css; здесь только сообщаем странице,
// что её показывает Electron (стеклянный фон) и снимаем фон с html/body.
// Для проверки тем: BODYSNATCH_THEME=light|dark запоминается до загрузки UI
if (process.env.BODYSNATCH_THEME) {
  try {
    const raw = localStorage.getItem('bodysnatch.theme');
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem('bodysnatch.theme', JSON.stringify({ ...current, mode: process.env.BODYSNATCH_THEME }));
  } catch {
    /* не критично */
  }
}
// Подбор плотности стекла: BODYSNATCH_ALPHA=45 переопределяет --glass-alpha
if (process.env.BODYSNATCH_ALPHA) {
  const alpha = process.env.BODYSNATCH_ALPHA;
  const applyAlpha = () => document.documentElement.style.setProperty('--glass-alpha', alpha + '%');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyAlpha, { once: true });
  else applyAlpha();
}
function markShell() {
  const apply = () => {
    document.documentElement.dataset.shell = 'electron';
    if (document.getElementById('bs-electron-window-shape')) return;
    const style = document.createElement('style');
    style.id = 'bs-electron-window-shape';
    style.textContent = 'html, body { background: transparent !important; }';
    document.documentElement.appendChild(style);
    // для журнала: видно, применилось ли скругление
    setTimeout(() => {
      try {
        const root = document.getElementById('root');
        const computed = root ? getComputedStyle(root) : null;
        ipcRenderer.send('bs-log', {
          shell: document.documentElement.dataset.shell,
          rootRadius: computed ? computed.borderRadius : 'нет',
          rootBg: computed ? (computed.backgroundImage || '').slice(0, 26) : 'нет',
        });
      } catch {
        /* диагностика не обязательна */
      }
    }, 800);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
}

markShell();

// ── перетаскивание окна за шапку ────────────────────────────────────────────
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="menuitem"], [role="menuitemradio"]';
const TITLEBAR_HEIGHT = 32;

let dragging = false;

window.addEventListener(
  'mousedown',
  (event) => {
    if (event.button !== 0 || event.clientY > TITLEBAR_HEIGHT) return;
    const target = event.target;
    if (target instanceof Element && target.closest(INTERACTIVE)) return;
    dragging = true;
    ipcRenderer.send('bs-drag-start', { x: event.screenX, y: event.screenY });
  },
  true,
);

window.addEventListener(
  'mousemove',
  (event) => {
    if (!dragging) return;
    ipcRenderer.send('bs-drag-move', { x: event.screenX, y: event.screenY });
  },
  true,
);

window.addEventListener(
  'mouseup',
  () => {
    if (!dragging) return;
    dragging = false;
    ipcRenderer.send('bs-drag-end');
  },
  true,
);
