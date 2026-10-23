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

export const api = {
  state: () =>
    fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(4000) }).then((r) => r.json() as Promise<Snapshot>),
  log: (n = 200) =>
    fetch(`/api/log?n=${n}`, { cache: 'no-store' }).then((r) => r.json() as Promise<{ ok: boolean; log: LogEntry[] }>),
  setEnabled: (enabled: boolean) => Promise.all([post<{ ok: boolean; enabled: boolean }>('/api/enabled', { enabled })]),
  saveConfig: (config: unknown) => post<{ ok: boolean }>('/api/config', { config }),
  moduleRoot: (module: string, root: string | null) => post<{ ok: boolean }>('/api/module-root', { module, root }),
  pickFolder: (title?: string) => post<{ ok: boolean; path?: string; message?: string }>('/api/pick-folder', { title }),
  open: (what: string, extra: Record<string, unknown> = {}) => post<{ ok: boolean }>('/api/open', { what, ...extra }),
  // установка идёт через UAC и окно подтверждения — таймаут с большим запасом
  certInstall: () => post<{ ok: boolean; trusted: boolean; error?: string }>('/api/cert/install', {}, 240000),
  proxyOn: () =>
    post<{
      ok: boolean;
      elevated?: boolean;
      cancelled?: boolean;
      error?: string;
      manual?: boolean;
      address?: string;
      systemProxy: Snapshot['systemProxy'];
    }>('/api/proxy/on', {}, 200000),
  proxyOff: () => post<{ ok: boolean; systemProxy: Snapshot['systemProxy'] }>('/api/proxy/off', {}),
  diagnose: () =>
    fetch('/api/proxy/diagnose', { cache: 'no-store' }).then(
      (r) => r.json() as Promise<{ writable: boolean; via: string; attempts: string[]; elevated: boolean }>,
    ),
  repairProxy: () =>
    post<{ ok: boolean; repaired: string[]; repairErrors: string[]; error?: string; systemProxy: Snapshot['systemProxy'] }>(
      '/api/proxy/repair',
      {},
    ),
  openSettings: () => post<{ ok: boolean }>('/api/open-settings', {}),
  quit: () => post<{ ok: boolean }>('/api/quit', {}),
  /** команды нативному окну: в браузере это no-op */
  shell: (action: string, extra?: Record<string, unknown>) => {
    try {
      const w = window as unknown as { chrome?: { webview?: { postMessage: (m: unknown) => void } } };
      w.chrome?.webview?.postMessage({ bs: action, ...(extra ?? {}) });
    } catch {
      /* окно обычное */
    }
  },
  certFileUrl: '/api/cert/file',
  hasNativeShell: () => {
    try {
      return !!(window as unknown as { chrome?: { webview?: unknown } }).chrome?.webview;
    } catch {
      return false;
    }
  },
};

/** Опрос состояния: на нём держится весь мастер. */
export function useState1s(intervalMs = 1200) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string>('');
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setError('');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    timer.current = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [refresh, intervalMs]);

  return { state, error, refresh };
}
