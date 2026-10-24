/**
 * Запуск Chrome (или Edge) с подменой в обход системных настроек.
 * Браузер получает PAC прямо из флага и работает в отдельном профиле, поэтому ему не мешает
 * ни VPN, перекрывающий системный прокси, ни установленность сертификата в системе:
 * корень BodySnatch принимается по отпечатку открытого ключа (SPKI).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';

/** Где искать браузеры: Chrome предпочтительнее, Edge — запасной вариант. */
export function browserCandidates(platformId, env = process.env, home = '') {
  if (platformId === 'win32') {
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
    return [
      ...roots.map((r) => ({ name: 'Chrome', exe: path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe') })),
      ...roots.map((r) => ({ name: 'Edge', exe: path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe') })),
    ];
  }
  if (platformId === 'darwin') {
    const apps = ['/Applications', path.posix.join(home, 'Applications')];
    return [
      ...apps.map((a) => ({
        name: 'Chrome',
        exe: path.posix.join(a, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      })),
      ...apps.map((a) => ({
        name: 'Edge',
        exe: path.posix.join(a, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
      })),
    ];
  }
  return [];
}

export const findBrowser = (platformId, env, home, exists = fs.existsSync) =>
  browserCandidates(platformId, env, home).find((c) => exists(c.exe)) || null;

/** SHA-256 от SPKI сертификата в base64 — формат флага --ignore-certificate-errors-spki-list. */
export const spkiHash = (pem) =>
  createHash('sha256')
    .update(new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');

export const browserArgs = ({ pacUrl, spki, profileDir }) => [
  `--user-data-dir=${profileDir}`,
  `--proxy-pac-url=${pacUrl}`,
  `--ignore-certificate-errors-spki-list=${spki}`,
  '--no-first-run',
  '--no-default-browser-check',
];

/** Запустить браузер отдельным процессом. Возвращает { ok, browser } или { ok:false, error }. */
export function launchBrowser({ platformId, pacUrl, certPem, profileDir, env = process.env, home = '' }) {
  const found = findBrowser(platformId, env, home);
  if (!found) return { ok: false, error: 'Chrome или Edge не найдены — установите один из них' };
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(found.exe, browserArgs({ pacUrl, spki: spkiHash(certPem), profileDir }), {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => undefined);
  child.unref();
  return { ok: true, browser: found.name };
}
