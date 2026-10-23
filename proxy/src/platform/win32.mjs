/**
 * Windows: системный прокси через PAC (WinINET, HKCU) и корневой сертификат
 * в хранилище текущего пользователя. Запись в HKCU и в пользовательское хранилище
 * прав администратора не требует.
 */
import { run, thumbprintOf } from './common.mjs';

export const id = 'win32';

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const REG = 'reg.exe';

async function readSettings() {
  const r = await run(REG, ['query', KEY]);
  const values = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^\s+(\S+)\s+REG_\w+\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

/** Что сейчас настроено в системе. */
export async function proxyState() {
  const v = await readSettings();
  const enable = String(v.ProxyEnable || '0');
  const n = enable.startsWith('0x') ? Number.parseInt(enable, 16) : Number.parseInt(enable, 10);
  return { pacUrl: v.AutoConfigURL || '', manual: { enabled: n === 1, server: v.ProxyServer || '' } };
}

/** Сообщить WinINET, что настройки изменились (браузеры подхватывают сразу). */
async function notifyChanged() {
  const script =
    '$s=\'[DllImport("wininet.dll")] public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);\';' +
    '$t=Add-Type -MemberDefinition $s -Name W -Namespace BS -PassThru;' +
    '$t::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null;' +
    '$t::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null';
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 });
}

const writePac = (url) => run(REG, ['add', KEY, '/v', 'AutoConfigURL', '/t', 'REG_SZ', '/d', url, '/f']);

export async function setPac(url) {
  const r = await writePac(url);
  if (!r.ok) throw new Error('не удалось записать настройки прокси: ' + r.stderr.trim());
  void notifyChanged();
}

/** Вернуть то, что было до нас (снимок из proxyState). */
export async function restoreProxy(prev) {
  const r =
    prev && prev.pacUrl ? await writePac(prev.pacUrl) : await run(REG, ['delete', KEY, '/v', 'AutoConfigURL', '/f']);
  // «значения нет» при удалении — не ошибка: прокси и так выключен
  const absent = /unable to find|не удается найти|не найден/i.test(r.stderr);
  if (!r.ok && !absent) throw new Error('не удалось вернуть настройки прокси: ' + r.stderr.trim());
  void notifyChanged();
}

export async function openProxySettings() {
  await run('cmd.exe', ['/c', 'start', '', 'ms-settings:network-proxy']);
}

// ── сертификат ──────────────────────────────────────────────────────────────
export async function certTrusted({ pem }) {
  const sha1 = thumbprintOf(pem);
  for (const hive of ['HKCU', 'HKLM']) {
    const r = await run(REG, [
      'query',
      `${hive}\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates\\${sha1}`,
    ]);
    if (r.ok) return true;
  }
  return false;
}

/** Windows сам покажет окно подтверждения установки корневого сертификата. */
export async function certInstall({ file }) {
  const r = await run('certutil.exe', ['-user', '-addstore', 'Root', file], { timeout: 180000 });
  return r.ok ? { ok: true } : { ok: false, error: (r.stdout + r.stderr).trim().split(/\r?\n/).slice(-2).join(' ') };
}

export async function certUninstall({ pem }) {
  const r = await run('certutil.exe', ['-user', '-delstore', 'Root', thumbprintOf(pem)], { timeout: 60000 });
  return { ok: r.ok };
}
