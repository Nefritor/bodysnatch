import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, Snapshot } from './types.js';

async function post<T>(url: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
      signal: ac.signal,
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
    return result as T;
  } finally {
    window.clearTimeout(timer);
  }
}

type Shell = { platform: string; send: (msg: Record<string, unknown>) => void };
const shell = (): Shell | undefined => (window as unknown as { bs?: Shell }).bs;

export const api = {
  state: async () => {
    const res = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const result = await res.json();
    if (!res.ok || !result.ok) throw new Error(result.error || 'не удалось получить состояние');
    return result as Snapshot;
  },
  log: (n = 200) =>
    fetch(`/api/log?n=${n}`, { cache: 'no-store' }).then((r) => r.json() as Promise<{ ok: boolean; log: LogEntry[] }>),
  clearLog: () => post<{ ok: boolean }>('/api/log/clear', {}),
  setEnabled: (enabled: boolean) => post<{ ok: boolean; enabled: boolean }>('/api/enabled', { enabled }, 200000),
  saveConfig: (config: unknown) => post<{ ok: boolean }>('/api/config', { config }),
  saveSite: (index: number, patch: unknown) => post<{ ok: boolean }>('/api/site', { index, patch }),
  roots: (action: 'add' | 'remove' | 'replace', path: string, replacement?: string) =>
    post<{ ok: boolean }>('/api/roots', { action, path, replacement }),
  moduleRoot: (module: string, root: string | null) => post<{ ok: boolean }>('/api/module-root', { module, root }),
  pickFolder: (title?: string) => post<{ ok: boolean; path?: string; message?: string }>('/api/pick-folder', { title }),
  open: (what: string, extra: Record<string, unknown> = {}) =>
    post<{ ok: boolean; message?: string }>('/api/open', { what, ...extra }),
  // системное окно подтверждения может ждать пользователя долго
  certInstall: () =>
    post<{ ok: boolean; trusted: boolean; error?: string; manual?: string }>('/api/cert/install', {}, 240000),
  certReset: () => post<{ ok: boolean; restart?: boolean }>('/api/cert/reset', {}, 240000),
  proxyOn: () =>
    post<{ ok: boolean; error?: string; systemProxy: Snapshot['systemProxy'] }>('/api/proxy/on', {}, 200000),
  proxyOff: () =>
    post<{ ok: boolean; error?: string; systemProxy: Snapshot['systemProxy'] }>('/api/proxy/off', {}, 200000),
  openBrowser: () => post<{ ok: boolean; browser?: string; error?: string }>('/api/browser/open', {}),
  openSettings: () => post<{ ok: boolean }>('/api/open-settings', {}),
  quit: () => post<{ ok: boolean }>('/api/quit', {}),
  /** команды окну приложения: в обычном браузере это no-op */
  shell: (action: string, extra?: Record<string, unknown>) => shell()?.send({ bs: action, ...(extra ?? {}) }),
  hasNativeShell: () => !!shell(),
  platform: () => shell()?.platform ?? '',
  certFileUrl: '/api/cert/file',
};

const LOG_CAP = 500;

/**
 * Состояние приложения: один запрос при старте, дальше сервер сам присылает события
 * (изменение состояния и новые записи журнала). Редкий опрос — только страховка.
 */
export function useBodysnatch() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const busy = useRef(false);
  const refreshAgain = useRef(false);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) {
      refreshAgain.current = true;
      return;
    }
    busy.current = true;
    try {
      const snapshot = await api.state();
      if (mounted.current) {
        setState(snapshot);
        setError('');
      }
    } catch (e) {
      if (mounted.current) setError(String((e as Error)?.message || e));
    } finally {
      busy.current = false;
      if (refreshAgain.current && mounted.current) {
        refreshAgain.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    void api
      .log(LOG_CAP)
      .then((r) => r?.log && setLog(r.log))
      .catch(() => undefined);

    const source = new EventSource('/api/events');
    source.addEventListener('state', () => void refresh());
    source.addEventListener('log-clear', () => setLog([]));
    source.addEventListener('open', () => {
      void refresh();
      void api
        .log(LOG_CAP)
        .then((r) => r?.log && setLog(r.log))
        .catch(() => undefined);
    });
    source.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as LogEntry;
        setLog((prev) => [entry, ...prev].slice(0, LOG_CAP));
      } catch {
        /* битое событие */
      }
    });
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const safety = window.setInterval(onVisible, 10000);
    return () => {
      mounted.current = false;
      refreshAgain.current = false;
      source.close();
      window.clearInterval(safety);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  const clearLog = useCallback(async () => {
    setLog([]);
    await api.clearLog().catch(() => undefined);
  }, []);

  return { state, error, refresh, log, clearLog };
}
