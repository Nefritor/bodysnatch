#!/usr/bin/env node
/** Клиент управляющего API. Токен читается из профиля и никогда не печатается. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectApp } from './app-connection.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1]) throw new Error('не задано значение ' + name);
  return args.splice(index, 2)[1];
}

try {
  const explicitProfile = args.includes('--data-dir') || !!process.env.BODYSNATCH_DATA_DIR;
  const defaultData =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'BodySnatch')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'BodySnatch')
        : path.join(os.homedir(), '.config', 'BodySnatch');
  const dataDir = path.resolve(option('--data-dir', process.env.BODYSNATCH_DATA_DIR || defaultData));
  const bodyFile = option('--body-file', '');
  const appPath = option('--app', process.env.BODYSNATCH_APP || '');
  const startTimeout = Number(option('--start-timeout', '30000'));
  const timeout = Number(option('--timeout', '300000'));
  const noStart = args.indexOf('--no-start');
  if (noStart >= 0) args.splice(noStart, 1);
  const [method = 'GET', route = '/api/state', json] = args;
  if (!['GET', 'POST', 'HEAD'].includes(method) || !route.startsWith('/api/'))
    throw new Error(
      'Использование: node bodysnatch-api.mjs [--data-dir PATH] [--body-file FILE] GET|POST /api/route [JSON]',
    );
  if (!Number.isFinite(startTimeout) || startTimeout < 1 || !Number.isFinite(timeout) || timeout < 1)
    throw new Error('таймаут должен быть положительным числом миллисекунд');
  const normalized = new URL(route, 'http://127.0.0.1');
  if (normalized.origin !== 'http://127.0.0.1' || !normalized.pathname.startsWith('/api/'))
    throw new Error('некорректный маршрут');
  const raw = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : json || '{}';
  const body = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('тело должно быть JSON-объектом');
  const discovery = await connectApp({
    dataDir,
    appPath,
    explicitProfile,
    startTimeout,
    autoStart: noStart < 0,
    quitting: method === 'POST' && normalized.pathname === '/api/quit',
  });
  if (!discovery) {
    console.log(JSON.stringify({ ok: true, alreadyStopped: true }));
    process.exit(0);
  }
  const target = new URL(route, discovery.baseUrl);
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
  console.error('BodySnatch API: ' + error.message);
  process.exitCode = 1;
}
