/** Аутентифицированный loopback API и обнаружение живого экземпляра приложения. */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApiServer } from './httpapi.mjs';

export async function startControlApi(engine, stateDir) {
  const token = randomBytes(32).toString('hex');
  const api = createApiServer(engine, { token, apiOnly: true });
  const file = path.join(stateDir, 'control-api.json');
  const temp = file + '.' + process.pid + '.tmp';
  try {
    const port = await api.listen(0);
    api.server.unref();
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      temp,
      JSON.stringify({
        apiVersion: 1,
        baseUrl: `http://127.0.0.1:${port}`,
        token,
        pid: process.pid,
        version: engine.version,
      }),
      { mode: 0o600 },
    );
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
  } catch (error) {
    await api.close();
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return {
    async close() {
      await api.close();
      // Старый экземпляр не должен удалить сведения о новом.
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.rmSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') engine.log('удаление control-api.json: ' + error.message);
      }
    },
  };
}
