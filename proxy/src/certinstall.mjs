/**
 * Установка корневого сертификата в доверенные Windows (текущий пользователь)
 * и проверка, что он уже установлен.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runElevated } from './sysproxy.mjs';
import * as sysproxy from './sysproxy.mjs';

const CERTUTIL = 'C:\\Windows\\System32\\certutil.exe';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REG = 'C:\\Windows\\System32\\reg.exe';
const PS = 'powershell';

/** SHA-1 от DER — по нему Windows адресует сертификат в хранилище. */
export function thumbprintOf(certPem) {
  const b64 = String(certPem)
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return createHash('sha1').update(Buffer.from(b64, 'base64')).digest('hex').toUpperCase();
}

/** Проверка через .NET API (без reg.exe и certutil): работает там, где утилиты
 *  заблокированы политикой. Возвращает имя хранилища, где сертификат найден. */
function storeViaDotnet(sha1) {
  const script = [
    `function Find($loc) {`,
    `  try {`,
    `    $s = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', $loc)`,
    `    $s.Open('ReadOnly')`,
    `    $n = ($s.Certificates | Where-Object { $_.Thumbprint -eq '${sha1}' } | Measure-Object).Count`,
    `    $s.Close()`,
    `    return $n`,
    `  } catch { return 0 }`,
    `}`,
    `Write-Output ('user=' + (Find 'CurrentUser') + ';machine=' + (Find 'LocalMachine'))`,
  ].join(' ');
  try {
    const out = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 12000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = /user=(\d+);machine=(\d+)/.exec(String(out));
    if (!m) return '';
    if (Number(m[1]) > 0) return 'user';
    if (Number(m[2]) > 0) return 'machine';
    return '';
  } catch {
    return '';
  }
}

/** Метка в data/cert-check.log, если сертификат не найден ни одним способом.
 *  Пишем не чаще раза в 10 секунд и не даём файлу расти бесконечно. */
let lastMissLog = 0;
function logCheckMiss(sha1) {
  const now = Date.now();
  if (now - lastMissLog < 10000) return;
  lastMissLog = now;
  try {
    const file = path.join(ROOT, 'data', 'cert-check.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > 64 * 1024) fs.writeFileSync(file, '');
    } catch {}
    fs.appendFileSync(file, `${new Date().toISOString()}  не найден ${sha1} (реестр, .NET, certutil)\n`);
  } catch {
    /* запись может быть запрещена — не мешаем работе */
  }
}

/** Последний результат проверки: где нашли или что все способы мимо. */
let lastCheck = { found: false, via: '', at: 0 };
export function lastCheckResult() {
  return { ...lastCheck };
}

/**
 * Сертификат установлен в «Доверенные корневые центры»?
 *
 * Три независимых способа — потому что на разных машинах доступно разное:
 * реестр, .NET API и certutil. Достаточно, чтобы сработал любой.
 * Результат кэшируем: проверка дорогая, а меняется она редко.
 */
let trustCache = { sha1: '', value: false, at: 0 };

export function invalidateTrust() {
  trustCache = { sha1: '', value: false, at: 0 };
}

export function isTrusted(certPem) {
  const sha1 = thumbprintOf(certPem);
  const now = Date.now();
  if (trustCache.sha1 === sha1 && now - trustCache.at < 2500) return trustCache.value;
  const value = computeTrust(sha1);
  trustCache = { sha1, value, at: now };
  return value;
}

function computeTrust(sha1) {
  const done = (ok, via) => {
    lastCheck = { found: ok, via, at: Date.now() };
    return ok;
  };
  // 1) быстро: ключ в реестре хранилища доверенных корней
  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync(
        REG,
        ['query', `${hive}\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates\\${sha1}`],
        { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      if (String(out).trim().length > 0) return done(true, hive === 'HKCU' ? 'реестр HKCU' : 'реестр HKLM');
    } catch {
      /* в этом хранилище нет */
    }
  }
  // 2) .NET API — на случай, когда reg.exe недоступен
  if (storeViaDotnet(sha1)) return done(true, '.NET');
  // 3) контрольная проверка через certutil: бывают хранилища, где ключ назван иначе
  for (const args of [
    ['-store', '-user', 'Root'],
    ['-store', 'Root'],
  ]) {
    try {
      const out = execFileSync(CERTUTIL, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (String(out).toLowerCase().includes(sha1.toLowerCase())) {
        return done(true, args[1] === 'Root' ? 'certutil (машина)' : 'certutil (пользователь)');
      }
    } catch {
      /* нет доступа к хранилищу */
    }
  }
  logCheckMiss(sha1);
  return done(false, '');
}

/**
 * Записать файл, не падая на заблокированном имени: если файл открыт
 * (например, диалогом сертификата), пишем рядом с уникальным суффиксом.
 */
function writeFileSafe(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    return file;
  } catch (e) {
    if (!['EPERM', 'EACCES', 'EBUSY', 'EROFS'].includes(e.code)) throw e;
    const dir = path.dirname(file);
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    try {
      const alt = path.join(dir, `${base}-${Date.now()}${ext}`);
      fs.writeFileSync(alt, data);
      return alt;
    } catch {
      // папка недоступна совсем — уходим во временную
      const tmp = path.join(os.tmpdir(), `bodysnatch-${Date.now()}${ext}`);
      fs.writeFileSync(tmp, data);
      return tmp;
    }
  }
}

/** Записать сертификат в файл (для ручной установки и для .crt-экспорта). */
export function writePem(certPem, dir, name = 'BodySnatch Desktop Root CA.crt') {
  return writeFileSafe(path.join(dir, name), certPem);
}

/** DER-файл .cer — его принимает стандартный диалог Windows (CryptExtOpenCER).
 *  Имя без пробелов: rundll32 передаёт путь как есть, пробелы ломают вызов. */
export function writeDer(certPem, dir, name = 'bodysnatch-ca.cer') {
  const b64 = String(certPem)
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return writeFileSafe(path.join(dir, name), Buffer.from(b64, 'base64'));
}

/**
 * Установить CA в доверенные. Три пути по порядку, от самого быстрого:
 *
 *   1) тихо через certutil из готового rootCA.pem — если Windows не требует
 *      подтверждения, сертификат встаёт сразу и никакое окно не нужно;
 *   2) стандартный диалог Windows (cryptext.dll) — окно «Сертификат» с кнопкой
 *      «Установить сертификат…», если подтверждение требуется;
 *   3) отдельное окно certutil (без создания файлов) — на случай, когда запись
 *      файлов в системе запрещена.
 *
 * Ни один путь не требует прав администратора: всё ставится в хранилище
 * текущего пользователя.
 */
function pemCandidates(dir) {
  const list = [path.join(dir, 'rootCA.pem'), path.join(ROOT, 'data', 'certs', 'rootCA.pem')];
  return list.filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/** Последняя попытка установки: что запускали и чем закончилось. */
let lastInstall = { via: '', code: null, at: 0, error: '' };
export function lastInstallResult() {
  return { ...lastInstall };
}

/** Записать ход установки в data/cert-install.log (не мешая работе). */
function logInstall(line) {
  try {
    const file = path.join(ROOT, 'data', 'cert-install.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (fs.statSync(file).size > 128 * 1024) fs.writeFileSync(file, '');
    } catch {}
    fs.appendFileSync(file, `${new Date().toISOString()}  ${line}\n`);
  } catch {
    /* запись может быть запрещена */
  }
}

/**
 * В какое хранилище ставить.
 *
 * С правами администратора `certutil -user` падает с
 * ERROR_BAD_IMPERSONATION_LEVEL (0x80070542): повышенный процесс не может
 * олицетворить пользователя и писать в его профиль. В этом случае ставим в
 * машинное хранилище — его видят все браузеры и все пользователи.
 */
function storeArgs(pem) {
  let elevated = false;
  try {
    elevated = sysproxy.isElevated();
  } catch {}
  return elevated ? ['-addstore', 'Root', pem] : ['-addstore', '-user', 'Root', pem];
}

function otherStoreArgs(pem) {
  let elevated = false;
  try {
    elevated = sysproxy.isElevated();
  } catch {}
  return elevated ? ['-addstore', '-user', 'Root', pem] : ['-addstore', 'Root', pem];
}

/** Установка через .NET API (PowerShell + X509Store).
 *
 * Это самый надёжный путь: не нужны ни окна, ни certutil, ни права админа.
 * certutil в процессе приложения падает с ERROR_BAD_IMPERSONATION_LEVEL
 * (0x80070542), а этот способ работает. */
function installViaDotnet(pem) {
  let elevated = false;
  try {
    elevated = sysproxy.isElevated();
  } catch {}
  const loc = elevated ? 'LocalMachine' : 'CurrentUser';
  const file = String(pem).replace(/'/g, "''");
  const script = [
    `try {`,
    `  $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${file}')`,
    `  $s = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root','${loc}')`,
    `  $s.Open('ReadWrite')`,
    `  $s.Add($c)`,
    `  $s.Close()`,
    `  Write-Output 'OK'`,
    `} catch { Write-Output ('ERR: ' + $_.Exception.Message) }`,
  ].join('\n');
  try {
    const out = execFileSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const ok = String(out).includes('OK');
    logInstall(`dotnet ${loc}: ${ok ? 'OK' : String(out).trim().slice(0, 160)}`);
    return ok;
  } catch (e) {
    logInstall(`dotnet ${loc} ошибка: ${String(e?.message || e).slice(0, 160)}`);
    return false;
  }
}

/** Тихая установка из PEM. true — сертификат встал. */
let silentUsable = true;
function installSilently(pem) {
  if (!silentUsable) return false;
  for (const args of [storeArgs(pem), otherStoreArgs(pem)]) {
    try {
      const r = spawnSync(CERTUTIL, args, {
        timeout: 2500,
        windowsHide: true,
        stdio: 'ignore',
      });
      lastInstall = { via: 'silent', code: r.status ?? null, at: Date.now(), error: '' };
      logInstall(`silent ${args[1] === 'Root' ? 'machine' : 'user'} status=${r.status} signal=${r.signal || ''}`);
      if (r.status === 0) return true;
    } catch (e) {
      lastInstall = { via: 'silent', code: null, at: Date.now(), error: String(e?.message || e) };
      logInstall(`silent error=${String(e?.message || e)}`);
    }
  }
  // Windows требует подтверждения — certutil висит до таймаута:
  // второй раз не тратим на это время в текущем запуске.
  silentUsable = false;
  return false;
}

export function install(certPem, dir) {
  // 0) .NET X509Store — самый надёжный путь: без окон, без certutil, без прав.
  //    Именно он срабатывает там, где certutil падает с BAD_IMPERSONATION_LEVEL.
  for (const pem of pemCandidates(dir)) {
    if (installViaDotnet(pem)) {
      lastInstall = { via: 'dotnet', code: 0, at: Date.now(), error: '' };
      invalidateTrust();
      return { ok: true, started: false, file: pem, via: 'dotnet' };
    }
  }

  // 1) тихо через certutil — если Windows не требует подтверждения
  for (const pem of pemCandidates(dir)) {
    if (installSilently(pem)) return { ok: true, started: false, file: pem, via: 'silent' };
  }

  // 2) certutil в своём окне: пишет прямо в «Доверенные корневые центры»
  //    текущего пользователя (или в машинное, если процесс повышенный).
  //    Мастер импорта не участвует, поэтому ошибки «хранилище доверия
  //    предприятия» здесь быть не может.
  for (const pem of pemCandidates(dir)) {
    try {
      const args = storeArgs(pem);
      const child = spawn(CERTUTIL, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      lastInstall = { via: 'certutil', code: null, at: Date.now(), error: '' };
      logInstall(`certutil запущен pid=${child.pid} store=${args[1] === 'Root' ? 'machine' : 'user'}`);
      child.on('exit', (code) => {
        lastInstall = { via: 'certutil', code, at: Date.now(), error: '' };
        logInstall(`certutil завершился code=${code}`);
        // 2147943746 = 0x80070542 ERROR_BAD_IMPERSONATION_LEVEL — нужен другой
        // склад: если не вышло в пользовательском, пробуем машинный и наоборот.
        if (code !== 0 && code !== null) {
          try {
            const retry = spawn(CERTUTIL, otherStoreArgs(pem), {
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            });
            logInstall(
              `certutil повтор pid=${retry.pid} store=${otherStoreArgs(pem)[1] === 'Root' ? 'machine' : 'user'}`,
            );
            retry.on('exit', (c2) => {
              lastInstall = { via: 'certutil', code: c2, at: Date.now(), error: '' };
              logInstall(`certutil повтор завершился code=${c2}`);
            });
            retry.unref();
          } catch {}
        }
      });
      child.unref();
      return { ok: true, started: true, file: pem, via: 'certutil' };
    } catch (e) {
      logInstall(`certutil не запустился: ${String(e?.message || e)}`);
      /* пробуем следующий путь */
    }
  }

  // 3) мастер импорта Windows — последний вариант, если certutil недоступен
  let file = null;
  for (const candidate of [dir, path.join(ROOT, 'data', 'certs'), os.tmpdir()]) {
    try {
      file = writeDer(certPem, candidate);
      break;
    } catch {
      file = null;
    }
  }
  if (file) {
    try {
      const child = spawn('rundll32.exe', ['cryptext.dll,CryptExtOpenCER', file], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return { ok: true, started: true, file, via: 'dialog' };
    } catch {
      /* ничего не осталось */
    }
  }

  return { ok: false, started: false, error: 'не найден файл корневого сертификата' };
}

/** Подсказка для ручной установки (кнопка «Скопировать команду»). */
export function installCommand(dir) {
  const file = path.join(dir, 'BodySnatch Desktop Root CA.crt');
  return `certutil -addstore -user Root "${file}"`;
}

/** Удалить наш CA из доверенных (только этот отпечаток, не все подряд). */
export function uninstall(certPem) {
  const sha1 = thumbprintOf(certPem);
  for (const args of [
    ['-delstore', '-user', 'Root', sha1],
    ['-delstore', 'Root', sha1],
  ]) {
    try {
      execFileSync(CERTUTIL, args, { windowsHide: true, timeout: 20000, stdio: 'ignore' });
    } catch {
      /* в этом хранилище его нет или нет прав */
    }
  }
  try {
    execFileSync(REG, ['delete', `HKCU\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates\\${sha1}`, '/f'], {
      windowsHide: true,
      timeout: 10000,
      stdio: 'ignore',
    });
  } catch {
    /* ключа нет */
  }
  invalidateTrust();
  return !isTrusted(certPem);
}
