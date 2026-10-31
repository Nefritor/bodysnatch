#!/usr/bin/env node
/** Клиент управляющего API. Токен читается из профиля и никогда не печатается. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1]) throw new Error('не задано значение ' + name);
  return args.splice(index, 2)[1];
}

try {
  const defaultData =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'BodySnatch')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'BodySnatch')
        : path.join(os.homedir(), '.config', 'BodySnatch');
  const dataDir = option('--data-dir', process.env.BODYSNATCH_DATA_DIR || defaultData);
  const bodyFile = option('--body-file', '');
  const timeout = Number(option('--timeout', '300000'));
  const [method = 'GET', route = '/api/state', json] = args;
  if (!['GET', 'POST', 'HEAD'].includes(method) || !route.startsWith('/api/'))
    throw new Error(
      'Использование: node bodysnatch-api.mjs [--data-dir PATH] [--body-file FILE] GET|POST /api/route [JSON]',
    );
  const discovery = JSON.parse(fs.readFileSync(path.join(dataDir, 'control-api.json'), 'utf8'));
  const base = new URL(discovery.baseUrl);
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    !base.port ||
    !/^[0-9a-f]{64}$/.test(discovery.token)
  )
    throw new Error('некорректный control-api.json');
  const target = new URL(route, base);
  if (target.origin !== base.origin || !target.pathname.startsWith('/api/')) throw new Error('некорректный маршрут');
  const raw = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : json || '{}';
  const body = JSON.parse(raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('тело должно быть JSON-объектом');
  const response = await fetch(target, {
    method,
    headers: {
      authorization: `Bearer ${discovery.token}`,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeout),
    redirect: 'error',
  });
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    for await (const chunk of response.body) process.stdout.write(chunk);
  } else {
    const rawResult = await response.text();
    if (response.headers.get('content-type')?.includes('application/json')) {
      const result = JSON.parse(rawResult);
      console.log(JSON.stringify(result, null, 2));
      if (!response.ok || result.ok === false) process.exitCode = 1;
    } else {
      process.stdout.write(rawResult);
      if (!response.ok) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(
    'BodySnatch API: ' +
      (error.code === 'ENOENT' ? 'приложение не запущено или выбран другой профиль (--data-dir)' : error.message),
  );
  process.exitCode = 1;
}
