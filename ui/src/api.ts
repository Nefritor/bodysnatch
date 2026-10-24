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
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

type Shell = { platform: string; send: (msg: Record<string, unknown>) => void };
const shell = (): Shell | undefined => (window as unknown as { bs?: Shell }).bs;

export const api = {
  state: () =>
    fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(8000) }).then(
      (r) => r.json() as Promise<Snapshot>,
    ),
  log: (n = 200) =>
    fetch(`/api/log?n=${n}`, { cache: 'no-store' }).then((r) => r.json() as Promise<{ ok: boolean; log: LogEntry[] }>),
  clearLog: () => post<{ ok: boolean }>('/api/log/clear', {}),
  setEnabled: (enabled: boolean) => post<{ ok: boolean; enabled: boolean }>('/api/enabled', { enabled }),
  saveConfig: (config: unknown) => post<{ ok: boolean }>('/api/config', { config }),
  moduleRoot: (module: string, root: string | null) => post<{ ok: boolean }>('/api/module-root', { module, root }),
  pickFolder: (title?: string) => post<{ ok: boolean; path?: string; message?: string }>('/api/pick-folder', { title }),
  open: (what: string, extra: Record<string, unknown> = {}) =>
    post<{ ok: boolean; message?: string }>('/api/open', { what, ...extra }),
  // системное окно подтверждения может ждать пользователя долго
  certInstall: () =>
    post<{ ok: boolean; trusted: boolean; error?: string; manual?: string }>('/api/cert/install', {}, 240000),
  certReset: () => post<{ ok: boolean; restart?: boolean }>('/api/cert/reset', {}),
  proxyOn: () =>
    post<{ ok: boolean; error?: string; systemProxy: Snapshot['systemProxy'] }>('/api/proxy/on', {}, 200000),
  proxyOff: () => post<{ ok: boolean; error?: string; systemProxy: Snapshot['systemProxy'] }>('/api/proxy/off', {}),
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

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      setState(await api.state());
      setError('');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api
      .log(LOG_CAP)
      .then((r) => r?.log && setLog(r.log))
      .catch(() => undefined);

    const source = new EventSource('/api/events');
    source.addEventListener('state', () => void refresh());
    source.addEventListener('log', (ev) => {
      try {
        const entry = JSON.parse((ev as MessageEvent).data) as LogEntry;
        setLog((prev) => [entry, ...prev].slice(0, LOG_CAP));
      } catch {
        /* битое событие */
      }
    });
    const safety = window.setInterval(() => void refresh(), 10000);
    return () => {
      source.close();
      window.clearInterval(safety);
    };
  }, [refresh]);

  const clearLog = useCallback(async () => {
    setLog([]);
    await api.clearLog().catch(() => undefined);
  }, []);

  return { state, error, refresh, log, clearLog };
}
