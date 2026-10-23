/**
 * Проверка обнаружения установленного сертификата: смотрим на хранилище
 * доверенных корней в реестре (без PowerShell).
 *
 *   node test/cert-trust.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureCA } from '../proxy/src/ca.mjs';
import { invalidateTrust, isTrusted, thumbprintOf } from '../proxy/src/certinstall.mjs';

const CERTS = path.join(os.tmpdir(), 'bs-trust-' + Date.now());
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const reg = (args) => {
  try {
    return execFileSync('C:\\Windows\\System32\\reg.exe', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const ca = ensureCA(CERTS);
const sha1 = thumbprintOf(ca.certPem);
const key = `HKCU\\Software\\Microsoft\\SystemCertificates\\Root\\Certificates\\${sha1}`;

check('до установки — не доверенный', isTrusted(ca.certPem) === false, sha1);

const t0 = Date.now();
reg(['add', key, '/f']); // имитируем появление записи в хранилище доверенных корней
const ms = Date.now() - t0;
check('запись в хранилище создана', reg(['query', key]).length > 0, `${ms} мс`);
invalidateTrust();
check('после установки — доверенный', isTrusted(ca.certPem) === true, sha1);

const t1 = Date.now();
const fast = isTrusted(ca.certPem);
const ms2 = Date.now() - t1;
check('проверка быстрая (без PowerShell)', fast === true && ms2 < 500, `${ms2} мс`);

reg(['delete', key, '/f']);
invalidateTrust();
check('после удаления — снова не доверенный', isTrusted(ca.certPem) === false);

try {
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
