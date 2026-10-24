'use strict';
/**
 * Ad-hoc подпись macOS-пакета (electron-builder afterPack).
 *
 * Без сертификата разработчика electron-builder оставляет .app с подписью, которая не покрывает
 * ресурсы пакета («code has no resources but signature indicates they must be present»).
 * На Apple Silicon такой пакет после скачивания открывается как «приложение повреждено».
 * Ad-hoc подпись (`-`) делает подпись целой: Gatekeeper спрашивает обычное «неизвестный
 * разработчик», которое обходится через «Открыть» в контекстном меню.
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc подпись ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
