'use strict';
/**
 * Мост интерфейса к оболочке: окно управляется командами через один IPC-канал.
 * Перетаскивание окна за шапку делает CSS (`-webkit-app-region: drag`).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bs', {
  platform: process.platform,
  send: (msg) => ipcRenderer.send('bs', msg),
  update: {
    state: () => ipcRenderer.invoke('bs-update', 'state'),
    check: () => ipcRenderer.invoke('bs-update', 'check'),
    download: () => ipcRenderer.invoke('bs-update', 'download'),
    install: () => ipcRenderer.invoke('bs-update', 'install'),
    /** Подписка на изменения; возвращает отписку. */
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('bs-update-state', handler);
      return () => ipcRenderer.removeListener('bs-update-state', handler);
    },
  },
});

// стеклянный фон окна: отметка для CSS
const mark = () => {
  document.documentElement.dataset.shell = 'electron';
  document.documentElement.dataset.platform = process.platform;
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark, { once: true });
else mark();
