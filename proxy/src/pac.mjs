/**
 * PAC-скрипт: браузер отправляет на наш прокси только хосты из масок.
 * Весь остальной трафик не касается приложения вовсе, а если прокси не отвечает,
 * сайты из маски открываются напрямую (`; DIRECT`).
 */
import { compile } from './rules.mjs';

const q = (s) => JSON.stringify(String(s));

/**
 * @param {object} config
 * @param {number} port порт прокси
 * @param {string} [fallback] что возвращать для остальных хостов ("PROXY h:p; DIRECT" для корпоративного прокси)
 */
export function buildPac(config, port, fallback = 'DIRECT') {
  const { hostGlobs } = compile(config);
  const ours = `PROXY 127.0.0.1:${port}; ${fallback}`;
  if (hostGlobs === null) return `function FindProxyForURL(url, host) { return ${q(ours)}; }\n`;
  const checks = hostGlobs.map((g) => `shExpMatch(host, ${q(g)})`).join(' ||\n      ');
  return [
    'function FindProxyForURL(url, host) {',
    '  host = host.toLowerCase();',
    hostGlobs.length ? `  if (${checks}) return ${q(ours)};` : '',
    `  return ${q(fallback)};`,
    '}',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
