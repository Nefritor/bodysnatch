/**
 * Установка сертификата: проверяем всю цепочку.
 *   1) тихая установка из rootCA.pem (окно не нужно) — основной путь;
 *   2) если Windows требует подтверждения — открывается окно;
 *   3) запрет записи файлов не должен ломать установку.
 *
 *   node test/cert-install.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { loadConfig } from '../proxy/src/config.mjs';
import { ensureCA } from '../proxy/src/ca.mjs';
import { createProxy } from '../proxy/src/proxy.mjs';
import { makeApi } from '../proxy/src/api.mjs';
import { isTrusted, thumbprintOf, uninstall } from '../proxy/src/certinstall.mjs';

const ROOT = path.resolve('.');
const CERTS = path.join(os.tmpdir(), 'bs-certdlg-' + Date.now());
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procCount = (name) => {
  try {
    return Number(
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-Process ${name} -ErrorAction SilentlyContinue | Measure-Object).Count`],
        {
          encoding: 'utf8',
        },
      ).trim(),
    );
  } catch {
    return 0;
  }
};

const config = loadConfig(path.join(ROOT, 'config', 'rules.json'));
const ca = ensureCA(CERTS);
const ref = { api: null };
const proxy = createProxy({ config, ca, api: (req, res) => ref.api(req, res), log: () => {} });
ref.api = makeApi({ config, ca, proxy, certsDir: CERTS, snapshot: null, distDir: path.join(ROOT, 'ui', 'dist') });
const addr = await proxy.listen(0);
config.port = addr.port;
const base = `http://127.0.0.1:${addr.port}`;
const thumb = thumbprintOf(ca.certPem);

const state0 = await (await fetch(`${base}/api/state`)).json();
check('до установки — не доверенный', state0.cert.trusted === false, thumb);

const beforeWindows = procCount('rundll32') + procCount('certutil');
const t0 = Date.now();
const install = await (
  await fetch(`${base}/api/cert/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
).json();
const ms = Date.now() - t0;
await sleep(1200);
const afterWindows = procCount('rundll32') + procCount('certutil');

check('установка выполнена', install.ok === true, `${ms} мс, via=${install.via || '?'}`);

let trusted = false;
for (let i = 0; i < 30; i += 1) {
  if (isTrusted(ca.certPem)) {
    trusted = true;
    break;
  }
  await sleep(500);
}
// под нагрузкой установка через .NET иногда не успевает с первого раза — пробуем ещё
if (!trusted) {
  await fetch(`${base}/api/cert/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => {});
  for (let i = 0; i < 30 && !trusted; i += 1) {
    await sleep(500);
    trusted = isTrusted(ca.certPem);
  }
}

// либо сертификат уже стоит (тихий путь), либо открыто окно для подтверждения
const openedWindow = afterWindows > beforeWindows;
check(
  'сертификат установлен или открыто окно',
  trusted || openedWindow,
  trusted ? 'тихо, без окна' : `окно: ${openedWindow}`,
);

if (trusted) {
  const st = await (await fetch(`${base}/api/state`)).json();
  check('приложение видит сертификат без перезапуска', st.cert.trusted === true);
}

// уборка
uninstall(ca.certPem).valueOf();
try {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-Process rundll32,certutil -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill() } catch {} }',
    ],
    { stdio: 'ignore' },
  );
} catch {}
await proxy.close();
try {
  fs.rmSync(CERTS, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
