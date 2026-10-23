/** Модули: все модули всех папок в окне, выбор — кликом по плашке. */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { ModuleInfo, RootInfo } from '../types.js';
import { norm, plural } from '../lib/format.js';
import { highlight } from '../lib/highlight.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Chip } from '../ui/Chip.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { Panel, PanelHead } from '../ui/Panel.js';

export type ModulesPanelProps = {
  modules: ModuleInfo[];
  roots: RootInfo[];
  /** перечитать состояние после выбора модуля */
  onChanged: () => void;
};

export const ModulesPanel = ({ modules, roots, onChanged }: ModulesPanelProps) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedCount = modules.filter((m) => m.selected).length;

  const byRoot = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roots.map((r) => ({
      root: r,
      list: modules
        .filter((m) => m.roots.some((p) => norm(p) === norm(r.path)) && (!q || m.name.toLowerCase().includes(q)))
        // выбранные модули показываем первыми
        .sort((a, b) => Number(!!b.selected) - Number(!!a.selected) || a.name.localeCompare(b.name)),
    }));
  }, [modules, roots, query]);

  const pick = async (moduleName: string, rootPath: string | null) => {
    await api.moduleRoot(moduleName, rootPath);
    onChanged();
  };

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  /** Одна плашка модуля — используется и в строке, и в окне «все модули». */
  const chip = (m: ModuleInfo, root: RootInfo) => {
    const active = m.selected === true && norm(m.activeRoot) === norm(root.path);
    return (
      <Chip
        key={m.name}
        active={active}
        dimmed={!active}
        title={
          active
            ? `используется${m.activeVia === 'выбран пользователем' ? ' (выбрано вручную)' : ''}`
            : `сделать активным (сейчас ${m.activeRoot})`
        }
        onClick={() => void pick(m.name, active ? null : root.path)}
      >
        {highlight(m.name, query)}
      </Chip>
    );
  };

  return (
    <PanelHead>
      {modules.length === 0 ? null : (
        <Button size="sm" onClick={() => setModalOpen(true)}>
          Модули
          <span className="text-xs font-normal text-ink-muted">
            {modules.length} {plural(modules.length, 'модуль', 'модуля', 'модулей')}
            {selectedCount ? ` · ${selectedCount === 1 ? 'выбран' : 'выбрано'} ${selectedCount}` : ''}
          </span>
        </Button>
      )}
      {modalOpen ? (
        <Modal
          wide
          title={`Модули · ${modules.length} ${plural(modules.length, 'модуль', 'модуля', 'модулей')}`}
          onClose={() => setModalOpen(false)}
          toolbar={
            <Input autoFocus placeholder="поиск модуля…" value={query} onChange={(e) => setQuery(e.target.value)} />
          }
        >
          {byRoot.map(({ root, list }) => (
            <div key={root.path} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-xs text-ink-soft" title={root.path}>
                  {root.path}
                </span>
                {!root.exists ? (
                  <Badge tone="warn" className="text-[10px]">
                    папки нет
                  </Badge>
                ) : null}
              </div>
              {list.length === 0 ? (
                <span className="text-xs text-ink-muted">модули не найдены по фильтру</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">{list.map((m) => chip(m, root))}</div>
              )}
            </div>
          ))}
        </Modal>
      ) : null}
    </PanelHead>
  );
};
