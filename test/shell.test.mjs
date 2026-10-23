/**
 * Оболочка Electron: статические проверки без запуска окна.
 *
 * Проверяем то, что легко сломать правкой: синтаксис скриптов, наличие иконки,
 * мост к интерфейсу, обработку сообщений и пути внутри пакета.
 *
 *   node test/shell.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHELL = path.join(ROOT, 'shell');
const MAIN = path.join(SHELL, 'main.cjs');
const PRELOAD = path.join(SHELL, 'preload.cjs');

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const mainSrc = fs.existsSync(MAIN) ? fs.readFileSync(MAIN, 'utf8') : '';
const preloadSrc = fs.existsSync(PRELOAD) ? fs.readFileSync(PRELOAD, 'utf8') : '';

check('shell/main.cjs есть', !!mainSrc, `${mainSrc.length} байт`);
check('shell/preload.cjs есть', !!preloadSrc, `${preloadSrc.length} байт`);
check('иконка оболочки на месте', fs.existsSync(path.join(SHELL, 'icon.ico')));

// синтаксис обоих файлов
for (const [name, file] of [
  ['main.cjs', MAIN],
  ['preload.cjs', PRELOAD],
]) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'ignore' });
    check(`синтаксис ${name}`, true);
  } catch (e) {
    check(`синтаксис ${name}`, false, String(e.message || e).slice(0, 100));
  }
}

// окно: прозрачный фон и системный материал
// прозрачность зависит от материала: с акрилом окно непрозрачное
check('прозрачность переключается материалом', /transparent:\s*!USE_MATERIAL/.test(mainSrc));
check('материал по умолчанию — акрил', /BODYSNATCH_MATERIAL \|\| 'acrylic'/.test(mainSrc));
check('материал окна настраивается', /setBackgroundMaterial\(\s*MATERIAL/.test(mainSrc));
check('интерфейс можно подменить через --ui', /--ui/.test(mainSrc) && /UI_OVERRIDE/.test(mainSrc));

// прокси запускается тем же файлом Electron в режиме Node
check('прокси через ELECTRON_RUN_AS_NODE', /ELECTRON_RUN_AS_NODE/.test(mainSrc));
check('прокси получает порт из конфига', /readPort\(/.test(mainSrc));

// мост к интерфейсу
check('мост window.bsBridge', /exposeInMainWorld\(\s*'bsBridge'/.test(preloadSrc));
check('заглушка chrome.webview', /chrome\.webview\s*=/.test(preloadSrc));
check('сообщения UI идут через bs-message', /bs-message/.test(mainSrc) && /bs-message/.test(preloadSrc));

// команды моста
for (const cmd of ['minimize', 'close', 'resize', 'show', 'openpath']) {
  check(`команда «${cmd}» обрабатывается`, new RegExp(`case '${cmd}'`).test(mainSrc));
}

// выход снимает системный прокси
check('при выходе снимается прокси', /healProxyNow/.test(mainSrc));

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
