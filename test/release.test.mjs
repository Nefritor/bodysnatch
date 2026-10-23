/**
 * Проверка собранного пакета Electron: раскладка, запуск, подмена через прокси.
 *
 *   node test/release.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const REL = path.join(ROOT, 'release', `BodySnatch-${pkg.version}-win-x64`);
const APP = path.join(REL, 'resources', 'app');
const EXE = path.join(REL, 'BodySnatch.exe');
const PORT = 8192;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

check('BodySnatch.exe есть', fs.existsSync(EXE));
check('оболочка в поставке', fs.existsSync(path.join(APP, 'shell', 'main.cjs')));
check('иконка в поставке', fs.existsSync(path.join(APP, 'shell', 'icon.ico')));
check('прокси в поставке', fs.existsSync(path.join(APP, 'proxy', 'src', 'main.mjs')));
check('интерфейс в поставке', fs.existsSync(path.join(APP, 'ui', 'dist', 'index.html')));
check('конфиг в поставке', fs.existsSync(path.join(APP, 'config', 'rules.json')));
check('зависимости прокси в поставке', fs.existsSync(path.join(APP, 'node_modules', 'node-forge')));

// Electron запускаем в режиме Node: проверяем именно прокси из поставки
const child = spawn(EXE, [path.join(APP, 'proxy', 'src', 'main.mjs'), '--port', String(PORT)], {
  cwd: APP,
  stdio: 'ignore',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});

const alive = async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/state`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

let state = null;
for (let i = 0; i < 60 && !state; i += 1) {
  await sleep(500);
  state = await alive();
}
check('пакет запустил прокси', !!state, state ? `порт ${state.port}` : '');

if (state) {
  const html = await fetch(`http://127.0.0.1:${PORT}/`)
    .then((r) => r.text())
    .catch(() => '');
  check('интерфейс отдаётся', html.includes('id="root"'), `${html.length} байт`);

  // настоящий запрос через прокси: локальный файл вместо серверного
  const caPath = state.cert?.certPath || path.join(APP, 'data', 'certs', 'rootCA.pem');
  try {
    const body = execFileSync(
      'C:\\Windows\\System32\\curl.exe',
      [
        '-sS',
        '--ssl-no-revoke',
        '-x',
        `http://127.0.0.1:${PORT}`,
        '--cacert',
        caPath,
        'https://fix-cdn.sbis.ru/static/resources/Telephony_online/_call/Page.js?x_module=test',
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 20000 },
    );
    check('из пакета подмена работает', body.includes('kekw'), `получено ${body.length} байт`);
  } catch (e) {
    check('из пакета подмена работает', false, String(e.message || e).slice(0, 120));
  }
}

await fetch(`http://127.0.0.1:${PORT}/api/quit`, { method: 'POST' }).catch(() => {});

let gone = false;
for (let i = 0; i < 30; i += 1) {
  await sleep(500);
  if ((await alive()) === null) {
    gone = true;
    break;
  }
}
check('после закрытия прокси остановлен', gone);

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
try {
  child.kill();
} catch {}
process.exitCode = passed === results.length ? 0 : 1;
