'use strict';
/**
 * Готовит PNG-иконки из shell/icon.ico (запуск: npx electron scripts/make-icons.cjs).
 * build/icon.png (1024) нужен electron-builder для .icns, shell/icon.png — окну, shell/tray.png — трею.
 */
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(ROOT, 'shell', 'icon.ico'));
  if (source.isEmpty()) {
    console.error('не читается shell/icon.ico');
    return app.exit(1);
  }
  const out = (file, size) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source.resize({ width: size, height: size, quality: 'best' }).toPNG());
    console.log('записан', path.relative(ROOT, file), size);
  };
  out(path.join(ROOT, 'build', 'icon.png'), 1024);
  out(path.join(ROOT, 'shell', 'icon.png'), 256);
  out(path.join(ROOT, 'shell', 'tray.png'), 36);
  return app.exit(0);
});
