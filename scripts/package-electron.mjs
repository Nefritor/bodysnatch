/**
 * Упаковка приложения (Electron — единственный вариант релиза).
 *
 *   release/BodySnatch-<версия>-win-x64/
 *   release/BodySnatch-<версия>-win-x64.zip
 *
 * Раскладка портативная: рядом с BodySnatch.exe лежат resources/app с
 * оболочкой, прокси, интерфейсом и правилами.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NAME = `BodySnatch-${pkg.version}-win-x64`;
const OUT = path.join(ROOT, 'release');
const DIR = path.join(OUT, NAME);

const log = (m) => console.log('[package-electron] ' + m);

const copy = (from, to) => {
  fs.cpSync(from, to, { recursive: true, force: true });
};

const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('[package-electron] нет бинарника Electron — выполните: node node_modules/electron/install.js');
  process.exit(1);
}

fs.rmSync(DIR, { recursive: true, force: true });
fs.rmSync(DIR + '.zip', { force: true });
fs.mkdirSync(DIR, { recursive: true });

log('Electron: копирую рантайм');
copy(electronDist, DIR);
// переименовываем исполняемый файл: так приложение выглядит своим
fs.renameSync(path.join(DIR, 'electron.exe'), path.join(DIR, 'BodySnatch.exe'));

const appDir = path.join(DIR, 'resources', 'app');
fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

log('оболочка и прокси');
copy(path.join(ROOT, 'shell'), path.join(appDir, 'shell'));
copy(path.join(ROOT, 'proxy'), path.join(appDir, 'proxy'));
copy(path.join(ROOT, 'config'), path.join(appDir, 'config'));

log('интерфейс');
copy(path.join(ROOT, 'ui', 'dist'), path.join(appDir, 'ui', 'dist'));

log('иконка');
copy(path.join(ROOT, 'shell', 'icon.ico'), path.join(appDir, 'shell', 'icon.ico'));

log('зависимости прокси');
fs.mkdirSync(path.join(appDir, 'node_modules'), { recursive: true });
copy(path.join(ROOT, 'node_modules', 'node-forge'), path.join(appDir, 'node_modules', 'node-forge'));

const appPkg = {
  name: 'bodysnatch-desktop',
  productName: 'BodySnatch Desktop',
  version: pkg.version,
  private: true,
  main: 'shell/main.cjs',
  description: pkg.description,
};
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(appPkg, null, 2) + '\n', 'utf8');

fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(DIR, 'ЧИТАЙ-МЕНЯ.txt'),
  [
    'BodySnatch Desktop (Electron)',
    '',
    'Запуск: BodySnatch.exe',
    '',
    'Отдельная сборка на Electron. Версия на C# лежит в отдельном архиве и ничем',
    'не связана с этой: можно держать обе и сравнивать.',
    '',
    'Системный прокси: 127.0.0.1:8180, правила — config\\rules.json,',
    'журнал — data\\host.log, журнал оболочки — data\\shell.log.',
    '',
    'Закрытие по крестику на этапе настройки завершает приложение и снимает',
    'системный прокси; в режиме работы окно уходит в трей.',
  ].join('\r\n'),
  'utf8',
);

log('архив');
try {
  if (fs.existsSync(DIR + '.zip')) fs.rmSync(DIR + '.zip');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${DIR}' -DestinationPath '${DIR}.zip' -CompressionLevel Optimal`,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
} catch (e) {
  log('архив не собрался: ' + e.message);
}

const sizeMb = fs.existsSync(DIR + '.zip') ? (fs.statSync(DIR + '.zip').size / 1024 / 1024).toFixed(2) : '—';
log('папка: ' + path.relative(ROOT, DIR));
log('архив: ' + path.relative(ROOT, DIR + '.zip') + ' — ' + sizeMb + ' МБ');
