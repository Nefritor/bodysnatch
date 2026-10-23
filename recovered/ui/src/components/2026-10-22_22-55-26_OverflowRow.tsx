/**
 * Строка бейджей в одну линию без прокрутки: что не влезло — уходит в окно
 * по кнопке с тремя точками. Хвост (например круглая кнопка «добавить») всегда
 * виден справа.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Chip } from '../ui/Chip.js';
import { Modal } from '../ui/Modal.js';
import { IconMore } from './icons.js';

export type OverflowRowProps = {
  items: ReactNode[];
  tail?: ReactNode;
  /** если задан, «…» открывает внешнее окно (все элементы), а не встроенный список */
  onMore?: () => void;
};

export const OverflowRow = ({ items, tail, onMore }: OverflowRowProps) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [widths, setWidths] = useState<number[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    setWidths(Array.from(el.children).map((c) => (c as HTMLElement).offsetWidth));
  }, [items.length, width]);

  const GAP = 6;
  const DOTS = 26;
  const tailWidth = tail ? 32 : 0;
  const total = widths.reduce((s, w) => s + w, 0) + Math.max(0, widths.length - 1) * GAP;
  const base = Math.max(0, width - tailWidth - (tail ? GAP : 0));
  let visible = widths.length;
  let overflow = false;
  if (width > 0 && total > base) {
    overflow = true;
    const avail = base - DOTS - GAP;
    let acc = 0;
    visible = 0;
    for (let i = 0; i < widths.length; i += 1) {
      const need = widths[i] + (i ? GAP : 0);
      if (acc + need > avail) break;
      acc += need;
      visible += 1;
    }
  }

  return (
    <div className="relative flex min-w-0 items-center" ref={rowRef}>
      <div className="flex min-w-0 items-center gap-1.5 py-1">{items.slice(0, visible)}</div>
      {overflow &&
        <Chip
          shape="round"
          className="ml-1"
          title={onMore ? 'показать все' : 'показать остальные'}
          onClick={() => (onMore ? onMore() : setOpen(true))}
        >
          <IconMore size={15} />
        </Chip>
      }
      <div className="ml-1 flex items-center gap-1 ">{tail}</div>
      <div className="pointer-events-none invisible absolute top-0 left-0 flex gap-1.5" ref={measureRef} aria-hidden>
        {items}
      </div>

      {open && !onMore ? (
        <Modal title={`Остальные (${Math.max(0, items.length - visible)})`} onClose={() => setOpen(false)}>
          <div className="flex flex-wrap gap-1.5">{items.slice(visible)}</div>
        </Modal>
      ) : null}
    </div>
  );
};
