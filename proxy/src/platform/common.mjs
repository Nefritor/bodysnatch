/** Общее для платформенных модулей: запуск утилит и отпечаток сертификата. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Запустить утилиту без оболочки и без блокировки event loop.
 * Всегда резолвится: { ok, code, stdout, stderr }.
 */
export function run(cmd, args = [], { timeout = 10000, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || (error && error.message) || ''),
        });
      },
    );
    if (input != null) child.stdin?.end(input);
  });
}

/** SHA-1 от DER, заглавными: так сертификат адресуют и Windows, и macOS. */
export function thumbprintOf(certPem) {
  const b64 = String(certPem)
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  return createHash('sha1').update(Buffer.from(b64, 'base64')).digest('hex').toUpperCase();
}
