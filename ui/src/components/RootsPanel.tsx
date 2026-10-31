/** Папки с локальным кодом: список без приоритетов и перетаскивания. */
import { useState } from 'react';
import { api } from '../api.js';
import type { RootInfo, ModuleInfo } from '../types.js';
import { plural } from '../lib/format.js';
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
  const [error, setError] = useState('');

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const picked = await api.pickFolder('Выберите папку с модулями');
      if (!picked.ok || !picked.path) return;
      await api.roots('add', picked.path);
      onChanged();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  /** Перевыбрать путь: новый выбор заменяет старый в том же месте списка. */
  const replace = async (target: string) => {
    setBusy(true);
    setError('');
    try {
      const picked = await api.pickFolder('Выберите папку с модулями');
      if (!picked.ok || !picked.path) return;
      await api.roots('replace', target, picked.path);
      onChanged();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: string) => {
    setBusy(true);
    setError('');
    try {
      await api.roots('remove', target);
      onChanged();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const open = async (target: string) => {
    await api.open('root', { root: target }).catch(() => null);
  };

  return (
    <Panel>
      {error ? (
        <p className="text-xs text-warn" role="alert">
          {error}
        </p>
      ) : null}
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

      <div className="lg-soft h-37.5 overflow-auto rounded-lg border-dashed p-2">
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
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() => void remove(r.path)}
                  title="убрать папку"
                >
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
