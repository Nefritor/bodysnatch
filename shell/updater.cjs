'use strict';
/**
 * Проверка и загрузка обновлений с GitHub Releases.
 *
 * Раз в полчаса (и через 15 секунд после старта, и при возвращении в окно, если проверка была
 * давно) спрашивает последний релиз. Условный запрос по ETag: ответ 304 не расходует лимит API
 * (60 запросов в час без токена). Найденную версию можно скачать (с индикатором прогресса и
 * проверкой SHA-256 из метаданных релиза) и установить.
 *
 * Состояние: idle → available → downloading → ready, при сбое — error (можно повторить).
 */
const { app, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPO = process.env.BODYSNATCH_UPDATE_REPO || 'Nefritor/bodysnatch';
const API_URL = process.env.BODYSNATCH_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
/** Подмена адреса API разрешает и http (для проверки на локальном сервере). */
const CUSTOM_API = !!process.env.BODYSNATCH_UPDATE_URL;

const CHECK_EVERY_MS = 30 * 60 * 1000;
const FIRST_CHECK_MS = Number(process.env.BODYSNATCH_UPDATE_FIRST_MS) || 15 * 1000;
const FOCUS_RECHECK_MS = 10 * 60 * 1000;

/**
 * Сравнение версий вида 1.2.3. Суффикс (`1.2.3-a`) — хотфикс той же версии: он новее версии без суффикса,
 * а между собой суффиксы сравниваются как строки. Предрелизов (beta) мы не выпускаем.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const [base, ...rest] = String(v).replace(/^v/i, '').split('-');
    return { nums: base.split('.').map((n) => Number.parseInt(n, 10) || 0), tag: rest.join('-') };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i += 1) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (x.tag === y.tag) return 0;
  return x.tag > y.tag ? 1 : -1;
}

/** Нужный установщик из файлов релиза: .exe для Windows, .dmg под архитектуру для macOS. */
function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const find = (re) => list.find((a) => a && re.test(String(a.name || '')));
  if (process.platform === 'win32') return find(/-win-x64\.exe$/i);
  if (process.platform === 'darwin') return find(new RegExp(`-mac-${process.arch}\\.dmg$`, 'i'));
  return undefined;
}

function createUpdater({ currentVersion, log, onState, onInstall }) {
  let state = { status: 'idle', version: '', progress: 0, received: 0, total: 0, speed: 0, error: '' };
  let asset = null; // { name, url, size, sha256 }
  let etag = '';
  let lastCheck = 0;
  let timer = null;
  let checking = false;

  const dir = () => path.join(app.getPath('temp'), 'BodySnatch-update');
  const filePath = () => path.join(dir(), asset.name);
  const set = (patch) => {
    state = { ...state, ...patch };
    onState({ ...state });
  };
  const allowedUrl = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || (CUSTOM_API && u.protocol === 'http:');
    } catch {
      return false;
    }
  };

  /** Файл уже скачан раньше (например, в прошлый запуск) и цел? */
  function cachedFileOk() {
    try {
      const file = filePath();
      if (!fs.existsSync(file)) return false;
      if (asset.size && fs.statSync(file).size !== asset.size) return false;
      if (asset.sha256) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        return hash === asset.sha256;
      }
      return true;
    } catch {
      return false;
    }
  }

  async function check() {
    if (checking || state.status === 'downloading') return;
    checking = true;
    try {
      const res = await net.fetch(API_URL, {
        headers: {
          'user-agent': `BodySnatch/${currentVersion}`,
          accept: 'application/vnd.github+json',
          ...(etag ? { 'if-none-match': etag } : {}),
        },
      });
      lastCheck = Date.now();
      if (res.status === 304) return;
      if (!res.ok) {
        log(`обновления: ответ ${res.status}`);
        return;
      }
      etag = res.headers.get('etag') || '';
      const release = await res.json();
      if (!release || release.draft || release.prerelease) return;
      const version = String(release.tag_name || '').replace(/^v/i, '');
      const found = pickAsset(release.assets);
      if (
        !version ||
        !found ||
        compareVersions(version, currentVersion) <= 0 ||
        !allowedUrl(found.browser_download_url)
      ) {
        if (state.status === 'available' || state.status === 'error') set({ status: 'idle' });
        return;
      }
      if ((state.status === 'ready' || state.status === 'available') && state.version === version) return;
      asset = {
        name: path.basename(String(found.name)),
        url: found.browser_download_url,
        size: Number(found.size) || 0,
        sha256: /^sha256:([0-9a-f]{64})$/i.exec(String(found.digest || ''))?.[1]?.toLowerCase() || '',
      };
      log(`обновления: доступна версия ${version}`);
      const have = cachedFileOk();
      set({
        status: have ? 'ready' : 'available',
        version,
        progress: have ? 1 : 0,
        received: have ? asset.size : 0,
        total: asset.size,
        speed: 0,
        error: '',
      });
    } catch (e) {
      log('обновления: ' + (e && e.message ? e.message : e));
    } finally {
      checking = false;
    }
  }

  async function download() {
    if (!asset || (state.status !== 'available' && state.status !== 'error')) return;
    const file = filePath();
    const part = file + '.part';
    set({ status: 'downloading', progress: 0, received: 0, speed: 0, error: '' });
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const res = await net.fetch(asset.url, { headers: { 'user-agent': `BodySnatch/${currentVersion}` } });
      if (!res.ok || !res.body) throw new Error(`сервер ответил ${res.status}`);
      const total = Number(res.headers.get('content-length')) || asset.size || 0;
      const hash = crypto.createHash('sha256');
      let received = 0;
      let lastEmit = 0;
      // скорость: сглаженная по скользящему окну примерно в секунду
      let mark = { at: Date.now(), bytes: 0 };
      let speed = 0;
      const source = Readable.fromWeb(res.body);
      source.on('data', (chunk) => {
        hash.update(chunk);
        received += chunk.length;
        const now = Date.now();
        if (total && now - lastEmit > 90) {
          lastEmit = now;
          if (now - mark.at >= 700) {
            const instant = ((received - mark.bytes) / (now - mark.at)) * 1000;
            speed = speed ? speed * 0.6 + instant * 0.4 : instant;
            mark = { at: now, bytes: received };
          }
          set({ progress: Math.min(0.99, received / total), received, total, speed });
        }
      });
      await pipeline(source, fs.createWriteStream(part));
      if (asset.sha256 && hash.digest('hex') !== asset.sha256) throw new Error('контрольная сумма не совпала');
      fs.renameSync(part, file);
      set({ status: 'ready', progress: 1, received: received || asset.size, total: total || asset.size });
      log(`обновления: ${asset.name} скачан`);
    } catch (e) {
      fs.rmSync(part, { force: true });
      log('обновления: загрузка не удалась — ' + (e && e.message ? e.message : e));
      set({ status: 'error', progress: 0, received: 0, speed: 0, error: String((e && e.message) || e) });
    }
  }

  function install() {
    if (state.status !== 'ready' || !asset) return;
    onInstall(filePath());
  }

  return {
    state: () => ({ ...state }),
    check,
    download,
    install,
    /** Запустить периодические проверки. */
    start() {
      setTimeout(() => void check(), FIRST_CHECK_MS);
      timer = setInterval(() => void check(), CHECK_EVERY_MS);
      timer.unref?.();
    },
    /** Окно снова в фокусе: если проверка была давно, повторяем. */
    maybeCheck() {
      if (Date.now() - lastCheck > FOCUS_RECHECK_MS) void check();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

module.exports = { createUpdater, compareVersions, pickAsset };
