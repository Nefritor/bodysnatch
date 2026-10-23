/**
 * Движок BodySnatch: конфиг, CA, прокси, системные настройки и API.
 * Один и тот же код запускается внутри Electron и из командной строки (main.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { loadConfig, saveConfig } from './config.mjs';
import { ensureCA, removeCA, baseDomains, domainPermitted } from './ca.mjs';
import { createProxy } from './proxy.mjs';
import { createUpstream, parseProxy } from './upstream.mjs';
import { FileCache } from './fileindex.mjs';
import { buildPac } from './pac.mjs';
import { compile } from './rules.mjs';
import { platform as defaultPlatform, thumbprintOf } from './platform/index.mjs';
import { makeApi } from './api.mjs';
import { createHash } from 'node:crypto';

/** "http=a:1;https=b:2" или "a:1" → "a:1" */
function manualServer(value) {
  const s = String(value || '');
  if (!s.includes('=')) return s;
  const parts = Object.fromEntries(s.split(';').map((p) => p.split('=')));
  return parts.https || parts.http || '';
}

/**
 * @param {object} o
 * @param {string} o.configPath файл правил пользователя
 * @param {string} [o.defaultConfigPath] шаблон правил для первого запуска
 * @param {string} o.stateDir папка для служебных файлов (снимок системных настроек)
 * @param {string} o.certsDir папка корневого CA
 * @param {string} [o.distDir] собранный интерфейс (для режима без Electron)
 * @param {{encrypt(s:string):Buffer, decrypt(b:Buffer):string}} [o.protector]
 * @param {object} [o.hooks] pickFolder(), openPath(p), quit() — возможности оболочки
 * @param {typeof defaultPlatform} [o.platform]
 */
export async function createEngine({
  configPath,
  defaultConfigPath = null,
  stateDir,
  certsDir,
  distDir = null,
  protector = null,
  hooks = {},
  platform = defaultPlatform,
  version = '0.0.0',
  port = 0,
  log = () => {},
}) {
  const events = new EventEmitter();
  events.setMaxListeners(50);
  let listenPort = 0;

  const config = loadConfig(configPath, defaultConfigPath);
  const basePort = port || Number(config.port) || 8180;
  config.port = basePort;
  // новый CA ограничивается доменами из масок: украденный ключ не позволит подделать чужие сайты
  const ca = await ensureCA(certsDir, { protector, domains: baseDomains(compile(config).hostGlobs) });

  const files = new FileCache({
    onChange: (names) => {
      proxy.notifyFilesChanged(names);
      events.emit('files', names);
    },
  });
  files.watch(rootPaths());

  let upstreamFromSystem = '';
  const upstream = createUpstream({
    getProxy: () => config.upstreamProxy || upstreamFromSystem,
    log,
  });

  const fallbackRoute = () => {
    const p = parseProxy(config.upstreamProxy || upstreamFromSystem);
    return p ? `PROXY ${p.host}:${p.port}; DIRECT` : 'DIRECT';
  };
  const pacText = () => buildPac(config, listenPort || basePort, fallbackRoute());

  const proxy = createProxy({
    config,
    ca,
    files,
    upstream,
    log,
    pac: () => pacText(),
    canIssue: (host) => domainPermitted(host, ca.domains),
    onLog: (entry) => events.emit('log', entry),
    onChange: () => events.emit('state'),
  });

  function rootPaths() {
    return (config.roots || [])
      .filter((r) => !r || typeof r === 'string' || r.enabled !== false)
      .map((r) => (typeof r === 'string' ? r : String((r && (r.abs || r.path)) || '')))
      .filter(Boolean);
  }

  // ── системные настройки ───────────────────────────────────────────────────
  const snapshotFile = path.join(stateDir, 'proxy-snapshot.json');
  const pacBase = () => `http://127.0.0.1:${listenPort}/proxy.pac`;
  const pacUrl = () => `${pacBase()}?v=${createHash('sha1').update(pacText()).digest('hex').slice(0, 8)}`;
  /** Любой PAC нашего приложения (даже с прошлого запуска на другом порту). */
  const isOurPac = (url) => /^http:\/\/127\.0\.0\.1:\d+\/proxy\.pac(\?|$)/.test(String(url || ''));

  const readSnapshot = () => {
    try {
      return JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    } catch {
      return null;
    }
  };
  const clearSnapshot = () => fs.rmSync(snapshotFile, { force: true });

  const cache = { sys: null, sysAt: 0, trust: false, trustAt: 0 };

  async function systemState(maxAge = 1500) {
    if (cache.sys && Date.now() - cache.sysAt < maxAge) return cache.sys;
    const s = await platform.proxyState();
    cache.sys = s;
    cache.sysAt = Date.now();
    return s;
  }

  async function certTrusted(maxAge = 4000) {
    if (Date.now() - cache.trustAt < maxAge) return cache.trust;
    cache.trust = await platform.certTrusted({ pem: ca.certPem, file: ca.certPath });
    cache.trustAt = Date.now();
    return cache.trust;
  }

  async function enableSystemProxy() {
    const current = await platform.proxyState();
    // свой же PAC от прошлого запуска не считаем «прежним состоянием»
    const previous = isOurPac(current.pacUrl) ? (readSnapshot()?.previous ?? null) : current;
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(snapshotFile, JSON.stringify({ previous }), 'utf8');
    upstreamFromSystem = previous && previous.manual?.enabled ? manualServer(previous.manual.server) : '';
    await platform.setPac(pacUrl());
    cache.sys = null;
    events.emit('state');
  }

  async function disableSystemProxy() {
    const current = await platform.proxyState();
    if (isOurPac(current.pacUrl)) {
      const saved = readSnapshot();
      await platform.restoreProxy(saved ? saved.previous : null);
    }
    clearSnapshot();
    cache.sys = null;
    events.emit('state');
  }

  /** Правила изменились: PAC мог измениться, браузерам нужно сказать об этом. */
  async function configChanged() {
    files.watch(rootPaths());
    files.clear();
    const current = await systemState(0).catch(() => null);
    if (current && isOurPac(current.pacUrl) && current.pacUrl !== pacUrl()) {
      await platform.setPac(pacUrl()).catch((e) => log('PAC: ' + e.message));
      cache.sys = null;
    }
    events.emit('state');
  }

  const engine = {
    version,
    config,
    ca,
    proxy,
    events,
    files,
    platform,
    hooks,
    certsDir,
    distDir,
    log,
    get port() {
      return listenPort;
    },
    pacUrl,
    pacText,
    isOurPac,
    systemState,
    certTrusted,
    invalidateTrust: () => {
      cache.trustAt = 0;
    },
    thumbprint: thumbprintOf(ca.certPem),
    /** Ограничения корня: какие домены он покрывает и вышли ли за них текущие маски. */
    caConstraints() {
      const needed = baseDomains(compile(config).hostGlobs);
      const wanted = needed || [];
      return {
        constrained: !!ca.domains,
        domains: ca.domains || [],
        uncovered: ca.domains ? wanted.filter((d) => !domainPermitted(d, ca.domains)) : [],
        canTighten: !ca.domains && !!needed,
      };
    },
    effectiveUpstream: () => config.upstreamProxy || upstreamFromSystem,
    rootPaths,
    hostGlobs: () => compile(config).hostGlobs,
    enableSystemProxy,
    disableSystemProxy,
    configChanged,
    saveConfig: () => saveConfig(config),
    resetCA: async () => {
      await platform.certUninstall({ pem: ca.certPem, file: ca.certPath }).catch(() => {});
      removeCA(certsDir);
    },

    /** Поднять прокси; занятый порт → следующий. После аварии вернуть прежние системные настройки. */
    async start() {
      let lastError;
      for (let p = basePort; p < basePort + 20; p += 1) {
        try {
          const addr = await proxy.listen(p, '127.0.0.1');
          listenPort = addr.port;
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (e.code !== 'EADDRINUSE') break;
        }
      }
      if (lastError) throw lastError;
      config.port = listenPort;

      // приложение могли убить, не дав снять PAC: возвращаем прежние настройки
      try {
        const current = await platform.proxyState();
        if (isOurPac(current.pacUrl)) {
          const saved = readSnapshot();
          await platform.restoreProxy(saved ? saved.previous : null);
          log('сняли PAC от прошлого запуска');
        }
        clearSnapshot();
      } catch (e) {
        log('проверка системного прокси: ' + e.message);
      }
      return listenPort;
    },

    async stop() {
      try {
        await disableSystemProxy();
      } catch (e) {
        log('не удалось вернуть системный прокси: ' + e.message);
      }
      files.close();
      await proxy.close();
    },
  };

  engine.api = makeApi(engine);
  return engine;
}
