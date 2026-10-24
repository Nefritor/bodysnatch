/** Папки с локальным кодом: список без приоритетов и перетаскивания. */
import { useState } from 'react';
import { api } from '../api.js';
import type { RootInfo, ModuleInfo } from '../types.js';
import { norm, plural } from '../lib/format.js';
import { Button } from '../ui/Button.js';
import { Panel, PanelHead, PanelTitle } from '../ui/Panel.js';
import { IconPencil, IconPlus } from './icons.js';
import { Spinner } from './Spinner.js';
import { ModulesPanel } from '../components/index.js';

export type RootsPanelProps = {
  roots: RootInfo[];
  modules: ModuleInfo[];
  /** перечитать состояние после изменения конфига */
  onChanged: () => void;
};

export const RootsPanel = ({ roots, modules, onChanged }: RootsPanelProps) => {
  const [busy, setBusy] = useState(false);

  /** конфиг хранит папки объектами {path, enabled} (или строками) — приводим к путям */
  const toPaths = (cfg: { roots?: unknown } | null) =>
    (((cfg?.roots ?? []) as unknown[]) || [])
      .map((r) => (typeof r === 'string' ? r : ((r as { path?: string })?.path ?? '')))
      .filter(Boolean) as string[];

  const add = async () => {
    setBusy(true);
    try {
      const picked = await api.pickFolder('Выберите папку с модулями');
      if (!picked.ok || !picked.path) return;
      const st = await api.state();
      const cfg = st.config ?? { sites: [] };
      const paths = toPaths(cfg);
      if (!paths.some((p) => norm(p) === norm(picked.path as string))) paths.push(picked.path as string);
      await api.saveConfig({ ...cfg, roots: paths });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  /** Перевыбрать путь: новый выбор заменяет старый в том же месте списка. */
  const replace = async (target: string) => {
    setBusy(true);
    try {
      const picked = await api.pickFolder('Выберите папку с модулями');
      if (!picked.ok || !picked.path) return;
      const st = await api.state();
      const cfg = st.config ?? { sites: [] };
      const paths = toPaths(cfg).map((p) => (norm(p) === norm(target) ? (picked.path as string) : p));
      await api.saveConfig({ ...cfg, roots: paths });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    const st = await api.state();
    const cfg = st.config ?? { sites: [] };
    const paths = toPaths(cfg).filter((p) => norm(p) !== norm(target));
    await api.saveConfig({ ...cfg, roots: paths });
    onChanged();
  };

  const open = async (target: string) => {
    await api.open('root', { root: target }).catch(() => null);
  };

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>
          <div className="flex gap-2 w-full justify-between">
            <div className="flex gap-2">
              <span>Папки с кодом</span>
              <Button size="sm" onClick={() => void add()} disabled={busy}>
                {busy ? <Spinner /> : <IconPlus size={13} />}
              </Button>
            </div>
            <ModulesPanel modules={modules} roots={roots} onChanged={onChanged} />
          </div>
        </PanelTitle>
      </PanelHead>

      <div className="p-2 border border-glass-line bg-tint-c border-dashed rounded-md h-37.5 overflow-auto">
        {roots.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-ink-muted h-full">
            Папки с кодом не добавлены
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {roots.map((r) => (
              <div key={r.path} className="flex items-center gap-2 lg-soft rounded-lg px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={r.path}>
                  {r.path}
                </span>
                <span className={r.exists ? 'text-xs text-ink-muted' : 'text-xs text-warn'}>
                  {r.exists
                    ? `${r.modules.length} ${plural(r.modules.length, 'модуль', 'модуля', 'модулей')}`
                    : 'папки нет'}
                </span>
                <Button
                  size="sm"
                  className="px-2"
                  title="выбрать другую папку"
                  onClick={() => void replace(r.path)}
                  disabled={busy}
                >
                  <IconPencil size={13} />
                </Button>
                <Button size="sm" onClick={() => void open(r.path)}>
                  открыть
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove(r.path)} title="убрать папку">
                  убрать
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
};
