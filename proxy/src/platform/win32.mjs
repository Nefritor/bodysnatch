/**
 * Windows: системный прокси через PAC (WinINET, HKCU) и корневой сертификат
 * в хранилище текущего пользователя. Запись в HKCU и в пользовательское хранилище
 * прав администратора не требует.
 */
import { run, thumbprintOf } from './common.mjs';
import { fileURLToPath } from 'node:url';

export const id = 'win32';

const REG = 'reg.exe';
const SCRIPT = fileURLToPath(new URL('./wininet.ps1', import.meta.url)).replace(
  /app\.asar([\\/])/,
  'app.asar.unpacked$1',
);
const wininet = async (action, args = []) => {
  const r = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Action', action, ...args],
    { timeout: 15000 },
  );
  if (!r.ok) throw new Error('WinINET: ' + r.stderr.trim());
  return JSON.parse(r.stdout.trim());
};

/** Что сейчас настроено в системе. */
export async function proxyState() {
  return wininet('Read');
}

export async function setPac(url) {
  await wininet('Set', ['-PacUrl', url]);
}

/** Вернуть то, что было до нас (снимок из proxyState). */
export async function restoreProxy(prev) {
  await wininet('Restore', [
    '-PacUrl',
    prev?.autoConfigUrl || prev?.pacUrl || '',
    '-AutoEnabled',
    prev?.pacUrl ? '1' : '0',
  ]);
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
