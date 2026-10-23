/**
 * macOS: системный прокси через PAC (networksetup по всем сетевым службам) и
 * корневой сертификат в связке «login» текущего пользователя.
 *
 * Модуль не проверялся на реальном Mac (разработка идёт на Windows): команды
 * взяты из документации networksetup(8) и security(1).
 */
import os from 'node:os';
import path from 'node:path';
import { run, thumbprintOf } from './common.mjs';

export const id = 'darwin';

const KEYCHAIN = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');

async function services() {
  const r = await run('networksetup', ['-listallnetworkservices']);
  return r.stdout
    .split('\n')
    .slice(1) // первая строка — пояснение про звёздочку
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('*'));
}

const field = (text, name) => new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(text)?.[1]?.trim() || '';

export async function proxyState() {
  const names = await services();
  const perService = await Promise.all(
    names.map(async (name) => {
      const auto = await run('networksetup', ['-getautoproxyurl', name]);
      return { name, pacUrl: field(auto.stdout, 'Enabled') === 'Yes' ? field(auto.stdout, 'URL') : '' };
    }),
  );
  const secure = names.length ? await run('networksetup', ['-getsecurewebproxy', names[0]]) : { stdout: '' };
  const host = field(secure.stdout, 'Server');
  const port = field(secure.stdout, 'Port');
  return {
    // pacUrl — любой включённый PAC; по нему узнаём «наш» прокси
    pacUrl: perService.find((s) => s.pacUrl)?.pacUrl || '',
    services: perService,
    manual: { enabled: field(secure.stdout, 'Enabled') === 'Yes', server: host && port ? `${host}:${port}` : '' },
  };
}

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** Выполнить набор команд networksetup; при отказе в правах — один запрос пароля администратора. */
async function applyAll(commands) {
  const failures = [];
  for (const args of commands) {
    const r = await run('networksetup', args);
    if (!r.ok) failures.push(args);
  }
  if (!failures.length) return;
  const script = failures.map((a) => ['networksetup', ...a].map(shq).join(' ')).join('; ');
  const apple = `do shell script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`;
  const r = await run('osascript', ['-e', apple], { timeout: 120000 });
  if (!r.ok) throw new Error('не удалось изменить сетевые настройки: ' + r.stderr.trim().slice(0, 200));
}

export async function setPac(url) {
  const names = await services();
  await applyAll(
    names.flatMap((n) => [
      ['-setautoproxyurl', n, url],
      ['-setautoproxystate', n, 'on'],
    ]),
  );
}

export async function restoreProxy(prev) {
  const names = await services();
  const before = new Map((prev?.services || []).map((s) => [s.name, s.pacUrl]));
  await applyAll(
    names.flatMap((n) => {
      const url = before.get(n);
      return url
        ? [
            ['-setautoproxyurl', n, url],
            ['-setautoproxystate', n, 'on'],
          ]
        : [['-setautoproxystate', n, 'off']];
    }),
  );
}

export async function openProxySettings() {
  await run('open', ['x-apple.systempreferences:com.apple.Network-Settings.extension']);
}

// ── сертификат ──────────────────────────────────────────────────────────────
export async function certTrusted({ file }) {
  const r = await run('security', ['verify-cert', '-c', file, '-L', '-p', 'basic']);
  return r.ok;
}

/** macOS попросит пароль или Touch ID в собственном окне. */
export async function certInstall({ file }) {
  const r = await run('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', KEYCHAIN, file], { timeout: 180000 });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim().slice(0, 200) };
}

export async function certUninstall({ pem, file }) {
  await run('security', ['remove-trusted-cert', file]);
  const r = await run('security', ['delete-certificate', '-Z', thumbprintOf(pem), KEYCHAIN]);
  return { ok: r.ok };
}
