/**
 * Системный прокси Windows (WinINET, HKCU): включение, выключение, снимок состояния.
 *
 * Порядок попыток:
 *   1) обычная запись (reg.exe → PowerShell → HKLM);
 *   2) если система запрещает — привилегированный помощник с запросом прав (UAC).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const KEY_MACHINE = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const REG = 'C:\\Windows\\System32\\reg.exe';
const PS_SETTINGS = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const PS_SETTINGS_MACHINE = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

export const OVERRIDE =
  'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>';

const regRun = (args, { quiet = true } = {}) =>
  execFileSync(REG, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'pipe'],
  }).toString();

const reason = (e) => {
  const raw = String((e && (e.stderr || e.message)) || e);
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.find((s) => !/^Command failed/i.test(s)) || lines[0] || 'неизвестная ошибка';
};

const readValueAt = (key, name) => {
  try {
    const out = regRun(['query', key, '/v', name]);
    const m = /\s+REG_\w+\s+(.+)\s*$/m.exec(out);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
};

const readValue = (name) => readValueAt(KEY, name);

const psRun = (script) =>
  execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`],
    { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();

const psSet = (pathKey, name, type, value) => {
  const v = type === 'REG_DWORD' ? String(Number(value)) : `'${String(value).replace(/'/g, "''")}'`;
  const t = type === 'REG_DWORD' ? 'DWord' : 'String';
  return psRun(
    `Set-ItemProperty -LiteralPath '${pathKey}' -Name '${name}' -Value ${v} -Type ${t} -Force -ErrorAction Stop`,
  );
};

/** Записать значение в реестр, пробуя несколько путей. */
const writeValue = (name, type, value) => {
  const attempts = [];
  const args = ['add', KEY, '/v', name, '/t', type, '/d', String(value), '/f'];

  try {
    regRun(args, { quiet: false });
    return { key: KEY, via: 'reg' };
  } catch (e) {
    attempts.push(`reg add (${e && e.status != null ? 'код ' + e.status : 'сбой'}): ${reason(e)}`);
  }

  try {
    try {
      regRun(['delete', KEY, '/v', name, '/f']);
    } catch {
      /* значения нет */
    }
    regRun(args);
    return { key: KEY, via: 'reg-recreate' };
  } catch (e) {
    attempts.push(`reg recreate: ${reason(e)}`);
  }

  try {
    psSet(PS_SETTINGS, name, type, value);
    return { key: KEY, via: 'powershell' };
  } catch (e) {
    attempts.push(`powershell HKCU: ${reason(e)}`);
  }

  try {
    psSet(PS_SETTINGS_MACHINE, name, type, value);
    return { key: KEY_MACHINE, via: 'powershell-hklm' };
  } catch (e) {
    attempts.push(`powershell HKLM: ${reason(e)}`);
  }

  const err = new Error(attempts.join(' · '));
  err.attempts = attempts;
  throw err;
};

const deleteValue = (name) => {
  try {
    regRun(['delete', KEY, '/v', name, '/f']);
  } catch {
    /* значения не было */
  }
};

export function refreshWinInet() {
  const ps = [
    '$sig = \'[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);\'',
    'Add-Type -Namespace Bs -Name Net -MemberDefinition $sig | Out-Null',
    '[Bs.Net]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null',
    '[Bs.Net]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null',
  ].join('; ');
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function getSystemProxy() {
  const rawEnabled = readValue('ProxyEnable');
  const rawServer = readValue('ProxyServer');
  const rawOverride = readValue('ProxyOverride');
  let enabled = false;
  if (rawEnabled) {
    const n = /^0x/i.test(rawEnabled) ? Number.parseInt(rawEnabled.slice(2), 16) : Number.parseInt(rawEnabled, 10);
    enabled = n === 1;
  }
  return { enabled, server: rawServer || '', override: rawOverride || '' };
}

export function snapshot() {
  return getSystemProxy();
}

/** Можно ли писать в ключ прямо сейчас (без UAC). */
let writeProbe = { at: 0, value: null };
export function canWriteProxy() {
  if (Date.now() - writeProbe.at < 15000 && writeProbe.value !== null) return writeProbe.value;
  let value = false;
  try {
    const out = psRun(`
try {
  $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', $true)
  if ($k) { $k.Close(); 'yes' } else { 'no' }
} catch { 'no' }
`);
    value = /yes/i.test(out);
  } catch {
    value = false;
  }
  writeProbe = { at: Date.now(), value };
  return value;
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Привилегированный помощник: показывает запрос прав (UAC) и выполняет
 * proxy-elevated.ps1 от администратора.
 */
export function runElevated(
  mode,
  { port = 8180, enabled = false, server = '', override = '', file = '', logPath = '' } = {},
) {
  const script = path.join(APP_ROOT, 'proxy-elevated.ps1');
  if (!fs.existsSync(script)) return { ok: false, error: 'не найден proxy-elevated.ps1' };
  const log = logPath || path.join(APP_ROOT, 'data', 'proxy-elevated.log');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode, '-LogPath', log];
  if (mode === 'cert') {
    if (!file) return { ok: false, error: 'не указан файл сертификата' };
    args.push('-CertFile', file);
  } else if (mode === 'restore') {
    args.push('-Port', String(port || 8180), '-Enabled', enabled ? '1' : '0');
    // Start-Process не принимает пустые строки в списке аргументов — пропускаем их
    if (server) args.push('-Server', server);
    if (override) args.push('-Override', override);
  } else {
    args.push('-Port', String(port || 8180));
  }
  // Start-Process -ArgumentList не экранирует пробелы: собираем строку сами,
  // иначе путь с пробелом («BodySnatch Desktop Root CA.crt») разваливается на части.
  const quoted = args
    .map((a) => (/[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a)))
    .join(' ');
  // Для сертификата окно не скрываем: certutil показывает подтверждение в своём окне,
  // а скрытое окно его подавляет.
  const windowStyle = mode === 'cert' ? 'Normal' : 'Hidden';
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    `  $p = Start-Process -FilePath 'powershell' -Verb RunAs -PassThru -WindowStyle ${windowStyle} -ArgumentList ${psQuote(quoted)}`,
    '  $p.WaitForExit()',
    '  exit $p.ExitCode',
    '} catch {',
    '  Write-Output $_.Exception.Message',
    '  exit 1223',
    '}',
  ].join('; ');

  try {
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 180000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (e) {
    const msg = `${(e && e.stdout) || ''} ${(e && e.stderr) || ''} ${(e && e.message) || ''}`.trim();
    // 1223 — пользователь отменил запрос; всё остальное — настоящая ошибка
    const cancelled = e && e.status === 1223 && /cancel|отмен|отклон/i.test(msg);
    return {
      ok: false,
      cancelled,
      error: cancelled ? 'запрос прав отменён' : msg.slice(0, 300) || 'не удалось получить права',
    };
  }
}

/** Включить прокси: сначала сами, при отказе — через запрос прав. */
export function apply(port, host = '127.0.0.1') {
  const before = snapshot();
  let attempts = [];
  try {
    writeValue('ProxyEnable', 'REG_DWORD', 1);
    writeValue('ProxyServer', 'REG_SZ', `${host}:${port}`);
    writeValue('ProxyOverride', 'REG_SZ', OVERRIDE);
    refreshWinInet();
    return { before, elevated: false };
  } catch (e) {
    attempts = e.attempts || [String(e.message || e)];
  }

  const r = runElevated('enable', { port });
  if (!r.ok) {
    try {
      restore({ before });
    } catch {}
    const err = new Error(
      `${attempts.join(' · ')}${r.cancelled ? ' · ' + r.error : ' · после запроса прав: ' + r.error}`,
    );
    err.cancelled = r.cancelled;
    throw err;
  }
  refreshWinInet();
  if (!isOurs(port)) {
    throw new Error(`права получены, но прокси не включился. Подробности: data\\proxy-elevated.log`);
  }
  return { before, elevated: true };
}

/** Вернуть системный прокси как было. */
/** Состояние машинных настроек прокси (HKLM) — их пишет привилегированный помощник. */
export function getMachineProxy() {
  const rawEnabled = readValueAt(KEY_MACHINE, 'ProxyEnable');
  const rawServer = readValueAt(KEY_MACHINE, 'ProxyServer');
  let enabled = false;
  if (rawEnabled) {
    const n = /^0x/i.test(rawEnabled) ? Number.parseInt(rawEnabled.slice(2), 16) : Number.parseInt(rawEnabled, 10);
    enabled = n === 1;
  }
  return { enabled, server: rawServer || '' };
}

/** В HKLM прописан наш прокси? */
export function machineOurs(port) {
  const m = getMachineProxy();
  return m.enabled && (!port || m.server === `127.0.0.1:${port}`);
}

/**
 * Вернуть системный прокси как было.
 * Возвращает { ok, current, machine, error? } — интерфейс показывает, получилось ли.
 */
export function restore(state, port) {
  let before = state && state.before ? state.before : state;

  // Снимка нет (приложение перезапустили после включения): наш прокси выключаем,
  // чужой не трогаем.
  if (!before) {
    const cur = getSystemProxy();
    const ours = cur.enabled && /^127\.0\.0\.1:\d+$/.test(cur.server);
    before = ours ? { enabled: false, server: '', override: '' } : cur;
  }

  // Снимок мог сам содержать наш же прокси (остался от прошлого запуска):
  // тогда восстанавливать его нельзя — иначе «выключение» снова его включает.
  if (port && before.server === `127.0.0.1:${port}`) {
    before = { enabled: false, server: '', override: before.override === OVERRIDE ? '' : before.override };
  } else if (!before.server && before.override === OVERRIDE) {
    before = { ...before, override: '' };
  }

  let directOk = false;
  let error = '';
  try {
    writeValue('ProxyEnable', 'REG_DWORD', before.enabled ? 1 : 0);
    if (before.server) writeValue('ProxyServer', 'REG_SZ', before.server);
    else deleteValue('ProxyServer');
    if (before.override) writeValue('ProxyOverride', 'REG_SZ', before.override);
    else deleteValue('ProxyOverride');
    refreshWinInet();
    directOk = true;
  } catch (e) {
    error = String((e && e.message) || e);
  }

  // Помощник мог записать HKLM — тогда без прав его не убрать, а система
  // продолжит ходить через наш прокси. Чистим с запросом прав.
  const needElevated = !directOk || machineOurs(port);
  if (needElevated) {
    const r = runElevated('restore', {
      port: port || 0,
      enabled: !!before.enabled,
      server: before.server || '',
      override: before.override || '',
    });
    if (r.cancelled) error = 'запрос прав отменён';
    else if (!r.ok) error = `${error} · ${r.error}`.trim();
  }

  const current = getSystemProxy();
  const ok = !(port ? isOurs(port) : false) && !machineOurs(port);
  return { ok, current, machine: getMachineProxy(), error, elevated: needElevated };
}

export function isOurs(port) {
  const cur = getSystemProxy();
  return cur.enabled && (cur.server === `127.0.0.1:${port}` || cur.server.endsWith(`:${port}`));
}

export function diagnose() {
  const before = getSystemProxy();
  const attempts = [];
  let writable = false;
  let via = '';
  try {
    const r = writeValue('ProxyEnable', 'REG_DWORD', before.enabled ? 1 : 0);
    writable = true;
    via = r.via;
  } catch (e) {
    attempts.push(...(e.attempts || [e.message]));
  }
  return { writable, via, attempts, current: before, user: process.env.USERNAME || '', elevated: isElevated() };
}

/** Вывод `whoami /groups`. Уровень целостности процесса не меняется за его
 *  жизнь, поэтому спрашиваем один раз: иначе каждый опрос состояния плодит
 *  whoami и консольный хост (и это заметно как мигание консоли). */
let integrityCache = null;
function integrityOnce() {
  if (integrityCache !== null) return integrityCache;
  try {
    integrityCache = String(
      execFileSync('whoami', ['/groups'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    integrityCache = '';
  }
  return integrityCache;
}

/** Низкий уровень целостности: приложение запущено в песочнице.
 *  Windows в таком режиме запрещает запись сертификатов и профиля. */
export function isLowIntegrity() {
  const out = integrityOnce();
  if (!out) return false;
  return /S-1-16-(4096|8192)\b/.test(out) ? /S-1-16-4096/.test(out) : false;
}
export function isElevated() {
  // Кто мы по уровню целостности: S-1-16-12288 — повышенный токен (админ),
  // S-1-16-8192 — обычный. whoami быстрее и надёжнее, чем net session
  // (тот зависит от службы Server).
  const out = integrityOnce();
  if (out) {
    if (/S-1-16-(12288|16384)/.test(out)) return true;
    if (/S-1-16-8192/.test(out)) return false;
  }
  try {
    execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true, timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Выдать текущему пользователю полный доступ к ключам прокси (без UAC). */
export function repairAccess() {
  const script = `
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$ok = @(); $bad = @()
foreach ($t in @(@('HKCU','Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'), @('HKLM','SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'))) {
  $hive = if ($t[0] -eq 'HKCU') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine }
  try {
    $key = $hive.OpenSubKey($t[1], [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [System.Security.AccessControl.RegistryRights]::ChangePermissions)
    if (-not $key) { throw 'ключ не открыт для смены прав' }
    $acl = $key.GetAccessControl()
    $rule = New-Object System.Security.AccessControl.RegistryAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.SetAccessRule($rule)
    $key.SetAccessControl($acl)
    $ok += ($t[0] + ': ' + $t[1])
    $key.Close()
  } catch { $bad += ($t[0] + ': ' + $_.Exception.Message) }
}
ConvertTo-Json -Compress -InputObject @{ ok = @($ok); bad = @($bad) }
`;
  try {
    const out = psRun(script).trim();
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    return {
      ok: Array.isArray(parsed.ok) && parsed.ok.length > 0,
      repaired: parsed.ok || [],
      errors: parsed.bad || [],
    };
  } catch (e) {
    return { ok: false, repaired: [], errors: [String((e && (e.stderr || e.message)) || e).slice(0, 300)] };
  }
}
