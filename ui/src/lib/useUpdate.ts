/** Состояние обновления приложения (приходит из оболочки Electron; в браузере его нет). */
import { useCallback, useEffect, useState } from 'react';

export type UpdateStatus = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

export type UpdateState = {
  status: UpdateStatus;
  version: string;
  /** доля скачанного, 0…1 */
  progress: number;
  /** скачано и всего, байт */
  received: number;
  total: number;
  /** скорость загрузки, байт/с (сглаженная) */
  speed: number;
  error: string;
};

type UpdateBridge = {
  state: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
  onState: (callback: (state: UpdateState) => void) => () => void;
};

const bridge = (): UpdateBridge | undefined => (window as unknown as { bs?: { update?: UpdateBridge } }).bs?.update;

export function useUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const b = bridge();
    if (!b) return undefined;
    let alive = true;
    void b.state().then((s) => alive && setState(s));
    const off = b.onState((s) => alive && setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const download = useCallback(() => void bridge()?.download(), []);
  const install = useCallback(() => void bridge()?.install(), []);
  return { state, download, install };
}
