#!/usr/bin/env node
/**
 * BodySnatch без Electron: прокси + API на отдельном порту, интерфейс в браузере.
 *
 *   node proxy/src/main.mjs [--config rules.json] [--port 8180] [--api-port 8181] [--ui-origin http://localhost:5179]
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from './engine.mjs';
import { createApiServer } from './httpapi.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const dataDir =
  process.env.BODYSNATCH_DATA_DIR ||
  (process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'BodySnatch')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'BodySnatch')
      : path.join(os.homedir(), '.config', 'BodySnatch'));

const engine = await createEngine({
  configPath: path.resolve(arg('config', path.join(dataDir, 'rules.json'))),
  defaultConfigPath: path.join(ROOT, 'config', 'rules.default.json'),
  stateDir: path.resolve(arg('state', dataDir)),
  certsDir: path.resolve(arg('certs', path.join(dataDir, 'certs'))),
  distDir: path.join(ROOT, 'ui', 'dist'),
  version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  port: Number(arg('port', '0')) || 0,
  log: (line) => console.log('[bodysnatch]', line),
});
const proxyPort = await engine.start();
const apiServer = createApiServer(engine, { allowedOrigins: [arg('ui-origin', 'http://localhost:5179')] });
const apiPort = await apiServer.listen(Number(arg('api-port', '8181')));
console.log(`[bodysnatch] прокси: 127.0.0.1:${proxyPort}   PAC: ${engine.pacUrl()}`);
console.log(`[bodysnatch] интерфейс и API: http://127.0.0.1:${apiPort}`);
console.log(`[bodysnatch] конфиг: ${engine.config.__path}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await apiServer.close();
  await engine.stop();
  process.exit(0);
};
engine.hooks.quit = stop;
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

export { engine };
