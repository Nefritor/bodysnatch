/** Платформенный слой: Windows и macOS; остальное — заглушка. */
const impl =
  process.platform === 'win32'
    ? await import('./win32.mjs')
    : process.platform === 'darwin'
      ? await import('./darwin.mjs')
      : await import('./unsupported.mjs');

export { thumbprintOf } from './common.mjs';
export const platform = impl;
