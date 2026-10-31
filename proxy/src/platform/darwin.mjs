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
  if (!r.ok) throw new Error('не удалось прочитать сетевые службы: ' + r.stderr.trim());
  return r.stdout
    .split('\n')
    .slice(1) // первая строка — пояснение про звёздочку
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('*'));
}

const field = (text, name) => new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(text)?.[1]?.trim() || '';

/** Определяем основную сетевую службу, а не первую строку networksetup. */
async function primaryService() {
  const global = await run('scutil', [], {
    input: 'show State:/Network/Global/IPv4\nshow State:/Network/Global/IPv6\nquit\n',
  });
  if (!global.ok) throw new Error('не удалось определить основную сетевую службу');
  const ids = [...global.stdout.matchAll(/PrimaryService\s*:\s*([A-Fa-f0-9-]+)/g)].map((match) => match[1]);
  if (!ids.length) return '';
  const setup = await run('scutil', [], {
    input: [...new Set(ids)].map((uuid) => `show Setup:/Network/Service/${uuid}\n`).join('') + 'quit\n',
  });
  if (!setup.ok) throw new Error('не удалось прочитать основную сетевую службу');
  return /UserDefinedName\s*:\s*([^\r\n]+)/.exec(setup.stdout)?.[1]?.trim() || '';
}

export async function proxyState() {
  const names = await services();
  const [activeService, perService] = await Promise.all([
    primaryService(),
    Promise.all(
      names.map(async (name) => {
        const auto = await run('networksetup', ['-getautoproxyurl', name]);
        if (!auto.ok) throw new Error('не удалось прочитать PAC службы ' + name);
        return {
          name,
          autoConfigUrl: field(auto.stdout, 'URL'),
          pacUrl: field(auto.stdout, 'Enabled') === 'Yes' ? field(auto.stdout, 'URL') : '',
        };
      }),
    ),
  ]);
  const active = perService.find((s) => s.name === activeService);
  const secure = names.length
    ? await run('networksetup', ['-getsecurewebproxy', active?.name || names[0]])
    : { stdout: '' };
  const host = field(secure.stdout, 'Server');
  const port = field(secure.stdout, 'Port');
  return {
    // При VPN primary может отсутствовать в networksetup: оставляем конфигурацию,
    // а отличие effectiveProxy показываем отдельным предупреждением.
    pacUrl: active ? active.pacUrl : perService.find((s) => s.pacUrl)?.pacUrl || '',
    activeService,
    services: perService,
    manual: { enabled: field(secure.stdout, 'Enabled') === 'Yes', server: host && port ? `${host}:${port}` : '' },
  };
}

/** Разбор вывода scutil --proxy: какой PAC реально действует в системе (с учётом VPN). */
export function parseScutilProxy(text) {
  const on = /ProxyAutoConfigEnable\s*:\s*1/.test(text);
  const url = /ProxyAutoConfigURLString\s*:\s*(\S+)/.exec(text)?.[1] || '';
  return { pacUrl: on ? url : '' };
}

/** Что система применяет на самом деле: активный VPN-туннель может переопределить настройки служб. */
export async function effectiveProxy() {
  const r = await run('scutil', ['--proxy']);
  return r.ok ? parseScutilProxy(r.stdout) : null;
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
  const script = failures.map((a) => ['networksetup', ...a].map(shq).join(' ')).join(' && ');
  const apple = `do shell script "${script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with administrator privileges`;
  const r = await run('osascript', ['-e', apple], { timeout: 120000 });
  if (!r.ok) throw new Error('не удалось изменить сетевые настройки: ' + r.stderr.trim().slice(0, 200));
}

export async function setPac(url) {
  const names = await services();
  if (!names.length) throw new Error('нет доступных сетевых служб для PAC');
  await applyAll(
    names.flatMap((n) => [
      ['-setautoproxyurl', n, url],
      ['-setautoproxystate', n, 'on'],
    ]),
  );
}

export async function restoreProxy(prev, ownedPac = '') {
  const current = await proxyState();
  const before = new Map((prev?.services || []).map((s) => [s.name, s]));
  await applyAll(
    current.services.flatMap((service) => {
      // Чужую/отключённую извне настройку не возвращаем к старому снимку.
      if (ownedPac && service.pacUrl.split('?')[0] !== ownedPac) return [];
      const saved = before.get(service.name);
      const url = saved?.autoConfigUrl || saved?.pacUrl;
      return [
        ...(url ? [['-setautoproxyurl', service.name, url]] : []),
        ['-setautoproxystate', service.name, saved?.pacUrl ? 'on' : 'off'],
      ];
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

/**
 * Установка корневого сертификата для текущего пользователя (связка «Вход»).
 *
 * Команда запускается от пользователя из его графической сессии, и macOS сама показывает
 * стандартное окно подтверждения (пароль или Touch ID); пока окно не подтверждено, команда ждёт.
 * Проверено на macOS 26 на реальном Mac. Варианты, которые НЕ работают:
 *   - osascript с правами администратора: команда идёт от root вне сессии, система отвечает
 *     «authorization was denied since no user interaction was possible»;
 *   - запись в системную связку без root: «SecCertificateAddToKeychain: Write permissions error».
 * Если окно подтверждения не удалось получить, возвращается готовая команда для терминала.
 */
export async function certInstall({ file }) {
  const args = ['add-trusted-cert', '-r', 'trustRoot', '-k', KEYCHAIN, file];
  const r = await run('security', args, { timeout: 180000 });
  if (r.ok) return { ok: true };
  const cancelled = /-128|canceled|cancelled|отмен/i.test(r.stderr);
  return {
    ok: false,
    error: cancelled ? 'установка отменена' : r.stderr.trim().slice(0, 200) || 'не удалось установить сертификат',
    manual: `security ${args.map(shq).join(' ')}`,
  };
}

/** Убрать сертификат и его доверие (системное окно подтверждения может появиться снова). */
export async function certUninstall({ pem, file }) {
  await run('security', ['remove-trusted-cert', file], { timeout: 180000 });
  const r = await run('security', ['delete-certificate', '-Z', thumbprintOf(pem), KEYCHAIN]);
  return { ok: r.ok };
}
