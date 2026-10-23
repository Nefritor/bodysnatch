'use strict';
/**
 * Мост интерфейса к оболочке: окно управляется командами через один IPC-канал.
 * Перетаскивание окна за шапку делает CSS (`-webkit-app-region: drag`).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bs', {
  platform: process.platform,
  send: (msg) => ipcRenderer.send('bs', msg),
});

// стеклянный фон окна: отметка для CSS
const mark = () => {
  document.documentElement.dataset.shell = 'electron';
  document.documentElement.dataset.platform = process.platform;
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark, { once: true });
else mark();
