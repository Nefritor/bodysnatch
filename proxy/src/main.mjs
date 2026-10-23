#!/usr/bin/env node
/**
 * BodySnatch Desktop — точка входа прокси.
 *
 *   node proxy/src/main.mjs --config config/rules.json --port 8180
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { ensureCA } from './ca.mjs';
import { createProxy } from './proxy.mjs';
import { makeApi } from './api.mjs';
import * as sysproxy from './sysproxy.mjs';
import * as certinstall from './certinstall.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const configPath = path.resolve(arg('config', path.join(ROOT, 'config', 'rules.json')));

// Сертификаты живут в профиле пользователя, а не рядом с exe: так установленный
// однажды корневой CA остаётся доверенным и после распаковки новой версии.
function defaultCertsDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const preferred = path.join(base, 'BodySnatch', 'certs');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    // переносим CA из папки приложения: уже установленный сертификат не должен потеряться
    const oldCert = path.join(ROOT, 'data', 'certs', 'rootCA.pem');
    const newCert = path.join(preferred, 'rootCA.pem');
    if (!fs.existsSync(newCert) && fs.existsSync(oldCert)) {
      fs.copyFileSync(oldCert, newCert);
      const oldKey = path.join(ROOT, 'data', 'certs', 'rootCA.key.pem');
      if (fs.existsSync(oldKey)) fs.copyFileSync(oldKey, path.join(preferred, 'rootCA.key.pem'));
    }
    return preferred;
  } catch {
    return path.join(ROOT, 'data', 'certs');
  }
}
const certsDir = path.resolve(arg('certs', defaultCertsDir()));
const port = Number(arg('port', '0')) || 8180;

let stopping = false;
const config = loadConfig(configPath);
config.port = port;
const ca = ensureCA(certsDir);

const snapshot = sysproxy.snapshot();
const ref = { api: null };

const proxy = createProxy({
  config,
  ca,
  api: (req, res) => (ref.api ? ref.api(req, res) : Promise.resolve()),
  log: (line) => console.log('[bodysnatch]', line),
});

ref.api = makeApi({
  config,
  ca,
  proxy,
  certsDir,
  snapshot,
  distDir: path.join(ROOT, 'ui', 'dist'),
  onQuit: () => stop(),
});

// диагностика токена: почему из процесса приложения запрещена запись
try {
  const who = execFileSync('whoami', ['/groups'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const lines = String(who)
    .split(/\r?\n/)
    .filter((l) => /S-1-16|deny|Only|олько/i.test(l));
  console.log('[bodysnatch] token приложения:\n' + lines.join('\n'));
} catch (e) {
  console.log('[bodysnatch] token: не удалось получить (' + e.message + ')');
}
const addr = await proxy.listen(port, '127.0.0.1');
console.log(`[bodysnatch] прокси+API: http://127.0.0.1:${addr.port}`);
console.log(`[bodysnatch] конфиг: ${configPath}`);
console.log(`[bodysnatch] CA: ${ca.certPath}${ca.created ? ' (создан)' : ''}`);
console.log(`[bodysnatch] CA в доверенных: ${certinstall.isTrusted(ca.certPem) ? 'да' : 'нет'}`);
console.log(`[bodysnatch] сайтов: ${config.sites.length}, модулей: ${Object.keys(config.moduleRoots).length}`);

// Сторож системного прокси. Отдельный процесс: если приложение убьют
// принудительно, настройка прокси не останется включённой «в никуда».
//
// Запускаем через wscript: он графический (консоли нет вообще) и, поставив
// `False` в Run, сразу выходит — сторож остаётся без родителя и переживает
// «завершить дерево процессов».
try {
  const guardPath = path.join(HERE, 'guard.mjs');
  if (fs.existsSync(guardPath)) {
    const vbsPath = path.join(ROOT, 'data', 'guard-run.vbs');
    const cmdLine = `"${process.execPath}" "${guardPath}" --port ${addr.port}`;
    const vbs = 'Set sh = CreateObject("WScript.Shell")\r\n' + `sh.Run "${cmdLine.replace(/"/g, '""')}", 0, False\r\n`;
    fs.mkdirSync(path.dirname(vbsPath), { recursive: true });
    // .vbs нужен в UTF-16 с BOM: UTF-8 BOM wscript не понимает
    fs.writeFileSync(vbsPath, '\uFEFF' + vbs, 'utf16le');
    spawn('wscript.exe', ['//nologo', '//B', vbsPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: ROOT,
    }).unref();
    console.log('[bodysnatch] сторож прокси запущен (без окна, вне дерева процессов)');
  }
} catch (e) {
  console.log('[bodysnatch] сторож прокси не запустился: ' + e.message);
}

const stop = async () => {
  if (stopping) return;
  stopping = true;
  try {
    // если окно уже не может вернуть настройки, делаем это здесь
    const r = sysproxy.restore(snapshot, addr.port);
    try {
      fs.appendFileSync(
        path.join(ROOT, 'data', 'proxy-stop.log'),
        new Date().toISOString() + ' ' + JSON.stringify({ snapshot, r }) + '\n',
      );
    } catch {}
  } catch {}
  await proxy.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// Сторож: если окно/хост исчезли (закрыли через диспетчер задач), прокси
// не должен оставаться включённым — иначе браузеры уйдут в никуда.
const parentPid = Number(arg('watch-parent', '0')) || process.ppid;
if (parentPid && parentPid > 1) {
  const watchdog = setInterval(() => {
    let alive = true;
    try {
      process.kill(parentPid, 0);
    } catch {
      alive = false;
    }
    if (!alive) {
      console.log('[bodysnatch] родительский процесс завершился — выключаюсь');
      void stop();
    }
  }, 2000);
  watchdog.unref?.();
}

export { proxy };
