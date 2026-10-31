/** Обнаружение и автоматический фоновый запуск установленного BodySnatch. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

function readDiscovery(dataDir) {
  const discovery = JSON.parse(fs.readFileSync(path.join(dataDir, 'control-api.json'), 'utf8'));
  const base = new URL(discovery.baseUrl);
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    !base.port ||
    base.username ||
    base.password ||
    discovery.apiVersion !== 1 ||
    !/^[0-9a-f]{64}$/.test(discovery.token)
  )
    throw new Error('некорректный control-api.json');
  return discovery;
}

const unavailable = (error) =>
  error.code === 'ENOENT' ||
  ['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code) ||
  error.name === 'TimeoutError';

async function probe(dataDir) {
  const discovery = readDiscovery(dataDir);
  const response = await fetch(new URL('/api/capabilities', discovery.baseUrl), {
    headers: { authorization: `Bearer ${discovery.token}` },
    signal: AbortSignal.timeout(1500),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(`API не принял подключение (HTTP ${response.status}); проверьте профиль и версию приложения`);
  const result = await response.json();
  if (!result.ok || result.apiVersion !== 1)
    throw new Error('приложение не поддерживает API v1; требуется BodySnatch 0.1.5 или новее');
  return discovery;
}

function findApp(explicit) {
  const candidates = explicit
    ? [explicit]
    : process.platform === 'win32'
      ? [
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'BodySnatch', 'BodySnatch.exe'),
          process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'BodySnatch', 'BodySnatch.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/BodySnatch.app', path.join(os.homedir(), 'Applications', 'BodySnatch.app')]
        : [];
  for (const candidate of candidates.filter(Boolean)) {
    const absolute = path.resolve(candidate);
    const executable =
      process.platform === 'darwin' && absolute.endsWith('.app')
        ? path.join(absolute, 'Contents', 'MacOS', 'BodySnatch')
        : absolute;
    try {
      if (fs.statSync(executable).isFile()) return executable;
    } catch {
      /* следующий путь */
    }
  }
  throw new Error('BodySnatch не найден: установите версию 0.1.5+ или передайте --app <путь> / BODYSNATCH_APP');
}

async function launch(executable, dataDir, explicitProfile) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (explicitProfile) env.BODYSNATCH_DATA_DIR = dataDir;
  const bundle =
    process.platform === 'darwin' && executable.endsWith('/Contents/MacOS/BodySnatch')
      ? path.dirname(path.dirname(path.dirname(executable)))
      : '';
  const args = bundle
    ? [
        '-n',
        '-g',
        '-j',
        '-a',
        bundle,
        ...(explicitProfile ? ['--env', `BODYSNATCH_DATA_DIR=${dataDir}`] : []),
        '--args',
        '--background',
      ]
    : ['--background'];
  const child = spawn(bundle ? '/usr/bin/open' : executable, args, {
    env,
    // У GUI-приложения нет консольного окна. SW_HIDE в STARTUPINFO поглощает
    // первый явный показ окна; фон задаётся собственным --background приложения.
    detached: true,
    stdio: 'ignore',
  });
  const result = { launcherOnly: !!bundle, exited: false, code: null };
  child.once('exit', (code) => {
    result.exited = true;
    result.code = code;
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    if (bundle)
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('LaunchServices не запустил BodySnatch')),
      );
    else child.once('spawn', resolve);
  });
  child.unref();
  return result;
}

export async function connectApp({
  dataDir,
  appPath,
  autoStart = true,
  startTimeout = 30000,
  explicitProfile = false,
  quitting = false,
}) {
  try {
    return await probe(dataDir);
  } catch (error) {
    if (!unavailable(error)) throw error;
  }
  if (quitting) return null;
  if (!autoStart) throw new Error('приложение не запущено или выбран другой профиль (--data-dir)');
  const executable = findApp(appPath);
  let launched = await launch(executable, dataDir, explicitProfile);
  let attempts = 1;
  let launchedAt = Date.now();
  const deadline = Date.now() + startTimeout;
  while (Date.now() < deadline) {
    await delay(200);
    try {
      return await probe(dataDir);
    } catch (error) {
      if (!unavailable(error)) throw error;
    }
    if (launched.exited && launched.code !== 0)
      throw new Error('BodySnatch завершился при запуске; проверьте shell.log');
    // При совпадении с завершающимся экземпляром single-instance lock может
    // отклонить новый процесс до снятия старой блокировки. Повторяем один раз.
    const declined = launched.launcherOnly ? Date.now() - launchedAt > 2000 : launched.exited;
    if (declined && attempts < 2) {
      await delay(1000);
      launched = await launch(executable, dataDir, explicitProfile);
      launchedAt = Date.now();
      attempts += 1;
    }
  }
  throw new Error(
    'API BodySnatch не появился вовремя; проверьте версию 0.1.5+, профиль и shell.log. Дальнейшие попытки запуска не выполняются',
  );
}
