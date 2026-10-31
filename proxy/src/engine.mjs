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
import { launchBrowser } from './browser.mjs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { startControlApi } from './control.mjs';

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
  let control = null;
  let monitor = null;
  let settleTimer = null;
  let proxyOperation = Promise.resolve();
  let routeMode = 'off';
  let checking = false;
  const serializeProxy = (fn) => {
    const next = proxyOperation.then(fn);
    proxyOperation = next.catch(() => {});
    return next;
  };

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
    enabled: false,
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

  const cache = { sys: null, sysAt: 0, trust: false, trustAt: 0, eff: null, effAt: 0 };
  /** Когда включили PAC: сразу после этого система ещё может не успеть его применить. */
  let enabledAt = 0;
  const SETTLE_MS = 3000;

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

  const ownsSystemPac = (s) => !!s && s.pacUrl?.split('?')[0] === pacBase();
  const hasSystemPac = (s, base = pacBase()) =>
    [s, ...(s?.services || [])].some((item) => item?.pacUrl?.split('?')[0] === base);

  async function enableSystemProxy() {
    const current = await platform.proxyState();
    // свой же PAC от прошлого запуска не считаем «прежним состоянием»
    const saved = readSnapshot()?.previous;
    let previous = ownsSystemPac(current) ? (saved ?? null) : current;
    if (current.services?.length) {
      const before = new Map((saved?.services || []).map((item) => [item.name, item]));
      const services = current.services.map((item) =>
        ownsSystemPac(item) ? before.get(item.name) || { ...item, pacUrl: '', autoConfigUrl: '' } : item,
      );
      previous = {
        ...current,
        pacUrl: services.find((item) => item.name === current.activeService)?.pacUrl || '',
        services,
      };
    }
    fs.mkdirSync(stateDir, { recursive: true });
    const tmp = snapshotFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ previous, pacUrl: pacBase() }), { mode: 0o600 });
    fs.renameSync(tmp, snapshotFile);
    upstreamFromSystem = previous && previous.manual?.enabled ? manualServer(previous.manual.server) : '';
    try {
      await platform.setPac(pacUrl());
      if (!ownsSystemPac(await platform.proxyState())) throw new Error('система не включила PAC BodySnatch');
    } catch (error) {
      // setPac может успеть изменить часть настроек до ошибки.
      try {
        // Откат частичного setPac возвращает все затронутые службы к снимку.
        await platform.restoreProxy(previous);
        clearSnapshot();
      } catch (rollback) {
        log('откат PAC: ' + rollback.message);
      }
      throw error;
    }
    cache.sys = null;
    enabledAt = Date.now();
    // через паузу интерфейс перепроверит, применила ли система PAC на самом деле
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => events.emit('state'), SETTLE_MS + 200);
    settleTimer.unref();
    events.emit('state');
  }

  /**
   * Наш PAC записан в настройки, но система его не применяет: активный VPN (Packet Tunnel и т. п.)
   * перекрывает системный прокси. Проверяется только там, где платформа умеет спросить, что
   * действует на самом деле (macOS); на остальных всегда false.
   */
  async function proxyOverridden(maxAge = 1500) {
    if (!platform.effectiveProxy || !enabledAt || Date.now() - enabledAt < SETTLE_MS) return false;
    if (!cache.eff || Date.now() - cache.effAt >= maxAge) {
      cache.eff = await platform.effectiveProxy().catch(() => null);
      cache.effAt = Date.now();
    }
    return !!cache.eff && !ownsSystemPac(cache.eff);
  }

  /** Запустить Chrome/Edge с PAC и доверием к корню прямо во флагах — в обход системных настроек. */
  function openBrowser() {
    return launchBrowser({
      platformId: platform.id,
      pacUrl: pacUrl(),
      certPem: ca.certPem,
      profileDir: path.join(stateDir, 'chrome-profile'),
      home: os.homedir(),
    });
  }

  async function disableSystemProxy() {
    const current = await platform.proxyState();
    if (hasSystemPac(current)) {
      const saved = readSnapshot();
      await platform.restoreProxy(saved ? saved.previous : null, pacBase());
    }
    clearSnapshot();
    cache.sys = null;
    enabledAt = 0;
    upstreamFromSystem = '';
    events.emit('state');
  }

  async function reconcileProxy(maxAge = 1500) {
    return serializeProxy(async () => {
      const sys = await systemState(maxAge);
      if (routeMode === 'system' && !ownsSystemPac(sys)) {
        routeMode = 'off';
        enabledAt = 0;
        proxy.setEnabled(false);
      }
      return sys;
    });
  }

  async function setEnabled(enabled) {
    return serializeProxy(async () => {
      if (enabled) {
        try {
          await enableSystemProxy();
        } catch (error) {
          cache.sys = null;
          if (routeMode === 'system') {
            routeMode = 'off';
            proxy.setEnabled(false);
          }
          throw error;
        }
        routeMode = 'system';
        proxy.setEnabled(true);
      } else {
        // Даже при отказе ОС подмена должна остановиться; снимок остаётся для повторного снятия PAC.
        routeMode = 'off';
        proxy.setEnabled(false);
        await disableSystemProxy();
      }
      return proxy.state.enabled;
    });
  }

  /** Правила изменились: PAC мог измениться, браузерам нужно сказать об этом. */
  function configChanged() {
    return serializeProxy(async () => {
      files.watch(rootPaths());
      files.clear();
      const current = await systemState(0).catch(() => null);
      if (ownsSystemPac(current) && current.pacUrl !== pacUrl()) {
        try {
          await platform.setPac(pacUrl());
        } finally {
          cache.sys = null;
          events.emit('state');
        }
      }
      events.emit('state');
    });
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
    reconcileProxy,
    ownsSystemPac,
    setEnabled,
    get routeMode() {
      return routeMode;
    },
    async launchBrowser() {
      return serializeProxy(async () => {
        const result = await openBrowser();
        if (result.ok) {
          // Отдельный профиль использует PAC независимо от системного прокси.
          if (routeMode !== 'system') routeMode = 'browser';
          proxy.setEnabled(true);
        }
        return result;
      });
    },
    proxyOverridden,
    openBrowser,
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
      const result = await platform.certUninstall({ pem: ca.certPem, file: ca.certPath });
      if (!result.ok || (await platform.certTrusted({ pem: ca.certPem, file: ca.certPath })))
        throw new Error('не удалось удалить сертификат из системы; ключ сохранён');
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
        const saved = readSnapshot();
        if (
          saved &&
          (saved.pacUrl
            ? hasSystemPac(current, saved.pacUrl)
            : [current, ...(current.services || [])].some((item) => isOurPac(item.pacUrl)))
        ) {
          await platform.restoreProxy(saved.previous, saved.pacUrl || '');
          log('сняли PAC от прошлого запуска');
        }
        clearSnapshot();
      } catch (e) {
        log('проверка системного прокси: ' + e.message);
      }
      control = await startControlApi(engine, stateDir);
      monitor = setInterval(async () => {
        // В off/browser системный PAC не управляет подменой. Не запускаем утилиты ОС в простое.
        if (checking || routeMode !== 'system') return;
        checking = true;
        try {
          const before = cache.sys && JSON.stringify(cache.sys);
          const sys = await reconcileProxy(0);
          if (before !== JSON.stringify(sys)) events.emit('state');
        } catch (error) {
          log('проверка PAC: ' + error.message);
        } finally {
          checking = false;
        }
      }, 3000);
      monitor.unref();
      return listenPort;
    },

    async stop() {
      clearInterval(monitor);
      clearTimeout(settleTimer);
      await control?.close();
      await engine.api.drain();
      try {
        await setEnabled(false);
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
