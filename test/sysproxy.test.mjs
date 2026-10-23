/**
 * Проверка системного прокси и сертификата на этой машине.
 * Меняет настройки и обязательно возвращает их обратно.
 *
 *   node test/sysproxy.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureCA } from '../proxy/src/ca.mjs';
import { getSystemProxy, apply, restore, isOurs } from '../proxy/src/sysproxy.mjs';
import { isTrusted, install, uninstall, thumbprintOf } from '../proxy/src/certinstall.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

// ── прокси: снимок → включение → проверка → возврат ────────────────────────
const before = getSystemProxy();
console.log('прокси до теста:', JSON.stringify(before));
check('снимок прочитан', typeof before.enabled === 'boolean', JSON.stringify(before));

const applied = apply(8199);
const during = getSystemProxy();
check(
  'прокси включён и указывает на нас',
  during.enabled && during.server === '127.0.0.1:8199',
  JSON.stringify(during),
);
check('isOurs распознаёт наш прокси', isOurs(8199));

restore(applied);
const after = getSystemProxy();
check(
  'прежнее состояние восстановлено',
  after.enabled === before.enabled && after.server === before.server,
  `было ${JSON.stringify(before)} → стало ${JSON.stringify(after)}`,
);

// ── сертификат: генерация, отпечаток, (не)доверие ──────────────────────────
const CERTS = path.join(os.tmpdir(), 'bodysnatch-cert-test-' + Date.now());
const ca = ensureCA(CERTS);
check('CA сгенерирован', /BEGIN CERTIFICATE/.test(ca.certPem) && /BEGIN/.test(ca.keyPem), ca.certPath);
check('отпечаток считается', /^[0-9A-F]{40}$/.test(thumbprintOf(ca.certPem)), thumbprintOf(ca.certPem));

const trustedBefore = isTrusted(ca.certPem);
check('новый CA ещё не в доверенных (ожидаемо)', trustedBefore === false, String(trustedBefore));

// установку в хранилище Windows не выполняем автоматически: система показывает
// окно подтверждения. Проверяем только, что .crt записывается на диск.
const file = install.length ? null : null;
const written = (await import('../proxy/src/certinstall.mjs')).writePem(ca.certPem, CERTS);
check('.crt-файл для установки записан', fs.existsSync(written) && fs.statSync(written).size > 500, written);

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);

try {
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}
process.exitCode = passed === results.length ? 0 : 1;
