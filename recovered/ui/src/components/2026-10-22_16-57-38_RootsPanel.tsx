/** Папки с локальным кодом: список без приоритетов и перетаскивания. */
import { useState } from 'react';
import { api } from '../api.js';
import type { RootInfo, ModuleInfo } from '../types.js';
import { norm, plural } from '../lib/format.js';
import { Button } from '../ui/Button.js';
import { Panel, PanelHead, PanelTitle } from '../ui/Panel.js';
import { IconPlus } from './icons.js';
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

  const remove = async (target: string) => {
    const st = await api.state();
    const cfg = st.config ?? { sites: [] };
    const paths = toPaths(cfg).filter((p) => norm(p) !== norm(target));
    await api.saveConfig({ ...cfg, roots: paths });
    onChanged();
  };

  const open = async (target: string) => {
    // в окне открываем через хост (ShellExecute) — надёжнее, чем spawn из прокси
    if (api.hasNativeShell()) {
      api.shell('openpath', { path: target });
      return;
    }
    await api.open('root', { root: target }).catch(() => null);
  };

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Папки с кодом</PanelTitle>
      </PanelHead>

      <div className="p-2 border border-glass-line bg-tint-b border-dashed rounded-md h-[150px] overflow-auto">
        {roots.length === 0 ? (
          <div className="text-xs text-center text-ink-muted">Папки с кодом не добавлены</div>
        ) : (
          <div className="flex flex-col gap-1.5 pb-9">
            {roots.map((r) => (
              <div
                key={r.path}
                className="flex items-center gap-2 rounded-md border border-glass-line bg-field px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={r.path}>
                  {r.path}
                </span>
                <span className={r.exists ? 'text-xs text-ink-muted' : 'text-xs text-warn'}>
                  {r.exists
                    ? `${r.modules.length} ${plural(r.modules.length, 'модуль', 'модуля', 'модулей')}`
                    : 'папки нет'}
                </span>
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

      <div className="flex -mt-11 ml-2 mb-4">
        <Button size="sm" onClick={() => void add()} disabled={busy}>
          {busy ? <Spinner /> : <IconPlus size={13} />} Добавить папку
        </Button>
      </div>
      <ModulesPanel modules={modules} roots={roots} onChanged={onChanged} />
    </Panel>
  );
};
