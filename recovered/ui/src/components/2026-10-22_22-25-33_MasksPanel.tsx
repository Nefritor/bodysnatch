/** Маска сайта: префикс × окружение × сайт; плюс словарь файлов (расширений). */
import { useEffect, useState } from 'react';
import type { MaskOption, SiteMask } from '../types.js';
import { Chip } from '../ui/Chip.js';
import { Input } from '../ui/Input.js';
import { Modal } from '../ui/Modal.js';
import { Panel, PanelHead, PanelHint, PanelTitle } from '../ui/Panel.js';
import { OverflowRow } from './OverflowRow.js';
import { IconClose, IconPlus } from './icons.js';

/** Группы значений маски: три измерения + файлы (расширения). */
export type MaskKind = 'prefixes' | 'envs' | 'hosts' | 'files';

export type MasksPanelProps = {
  mask: SiteMask;
  onChange: (next: SiteMask) => void;
  files: MaskOption[];
  onFilesChange: (next: MaskOption[]) => void;
};

export const MasksPanel = ({ mask, onChange, files, onFilesChange }: MasksPanelProps) => {
  const [adding, setAdding] = useState<MaskKind | null>(null);
  const [draft, setDraft] = useState('');
  const [modalKind, setModalKind] = useState<MaskKind | null>(null);

  useEffect(() => {
    if (!modalKind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalKind(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalKind]);

  const getList = (kind: MaskKind): MaskOption[] => (kind === 'files' ? files : mask[kind]);
  const setList = (kind: MaskKind, next: MaskOption[]) => {
    if (kind === 'files') onFilesChange(next);
    else onChange({ ...mask, [kind]: next });
  };

  const toggle = (kind: MaskKind, value: string) =>
    setList(
      kind,
      getList(kind).map((o) => (o.value === value ? { ...o, enabled: !o.enabled } : o)),
    );

  const addValue = (kind: MaskKind) => {
    const value = draft
      .trim()
      .toLowerCase()
      .replace(/^[.\-*]+/, '')
      .replace(/\s+/g, '');
    setDraft('');
    setAdding(null);
    if (!value) return;
    if (getList(kind).some((o) => o.value.toLowerCase() === value)) return;
    setList(kind, [...getList(kind), { value, enabled: true, custom: true }]);
  };

  /** Удалять можно только свои значения: они помечены флагом custom в конфиге. */
  const canRemove = (o: MaskOption) => o.custom === true;
  const removeValue = (kind: MaskKind, value: string) =>
    setList(
      kind,
      getList(kind).filter((o) => o.value !== value),
    );

  const rows: { kind: MaskKind; label: string; placeholder: string }[] = [
    { kind: 'prefixes', label: 'Префикс', placeholder: 'свой префикс' },
    { kind: 'envs', label: 'Окружение', placeholder: 'своё окружение' },
    { kind: 'hosts', label: 'Сайт', placeholder: 'свой сайт' },
    { kind: 'files', label: 'Файлы', placeholder: 'своё расширение' },
  ];

  const opt = (kind: MaskKind, o: MaskOption) => (
    <span key={o.value} className="relative inline-flex">
      <Chip active={o.enabled} dimmed={!o.enabled} onClick={() => toggle(kind, o.value)}>
        {o.value}
      </Chip>
      {canRemove(o) ? (
        <button
          type="button"
          className="absolute -top-1 -right-1 size-3.5 place-items-center rounded-full bg-bad/10 text-bad shadow-sm outline"
          title="удалить"
          onClick={() => removeValue(kind, o.value)}
        >
          <IconClose size={9} strokeWidth={2.6} />
        </button>
      ) : null}
    </span>
  );

  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Маска</PanelTitle>
        <PanelHint>{'https://<префикс>-<окружение>.<сайт>'}</PanelHint>
      </PanelHead>

      {rows.map(({ kind, label, placeholder }) => (
        <div className="flex items-center gap-3" key={kind}>
          <span className="w-20 shrink-0 text-xs text-ink-muted">{label}</span>
          <div className="min-w-0 flex-1">
            <OverflowRow
              items={getList(kind).map((o) => opt(kind, o))}
              onMore={getList(kind).length > 0 ? () => setModalKind(kind) : undefined}
              tail={
                adding === kind ? (
                  <div className="flex items-center gap-1">
                    <Input
                      scale="xs"
                      autoFocus
                      className="w-32"
                      value={draft}
                      placeholder={placeholder}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addValue(kind);
                        if (e.key === 'Escape') {
                          setDraft('');
                          setAdding(null);
                        }
                      }}
                    />
                    <Chip shape="round" title="добавить" onClick={() => addValue(kind)}>
                      <IconPlus size={13} />
                    </Chip>
                    <Chip
                      shape="round"
                      title="отменить"
                      onClick={() => {
                        setDraft('');
                        setAdding(null);
                      }}
                    >
                      <IconClose size={12} />
                    </Chip>
                  </div>
                ) : (
                  <Chip
                    shape="round"
                    title={`добавить ${label.toLowerCase()}`}
                    onClick={() => {
                      setDraft('');
                      setAdding(kind);
                    }}
                  >
                    <IconPlus size={13} />
                  </Chip>
                )
              }
            />
          </div>
        </div>
      ))}

      {modalKind ? (
        <Modal
          title={`${rows.find((r) => r.kind === modalKind)?.label} · ${getList(modalKind).length}`}
          onClose={() => setModalKind(null)}
        >
          <div className="flex flex-wrap gap-1.5">{getList(modalKind).map((o) => opt(modalKind, o))}</div>
        </Modal>
      ) : null}
    </Panel>
  );
};
