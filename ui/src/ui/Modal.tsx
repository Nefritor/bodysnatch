/**
 * Модальное окно. Рисуется порталом в <body>: иначе предок с backdrop-filter
 * превращается в containing block и обрезает подложку — окно вылезает за карточку.
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from '../components/icons.js';
import { cn } from './cn.js';

export type ModalProps = {
  title?: ReactNode;
  onClose: () => void;
  /** поиск или иное поле под заголовком */
  toolbar?: ReactNode;
  /** широкая карточка (для списков) */
  wide?: boolean;
  children: ReactNode;
};

export const Modal = ({ title, onClose, toolbar, wide, children }: ModalProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: 'var(--c-scrim)' }}
      onClick={onClose}
    >
      <div
        className={cn(
          'flex max-h-[70vh] flex-col gap-3 overflow-hidden rounded-panel border border-surface-line',
          'shadow-matte backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]',
          wide ? 'w-[min(620px,92vw)]' : 'w-[min(520px,92vw)]',
        )}
        style={{ background: 'var(--c-surface-glass)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-line px-4 py-2.5">
          <span className="text-sm font-semibold text-ink">{title}</span>
          <button
            type="button"
            className="grid size-7 place-items-center rounded-pill text-ink-muted hover:bg-hover hover:text-ink"
            onClick={onClose}
            aria-label="закрыть"
          >
            <IconClose size={13} />
          </button>
        </div>
        {toolbar ? <div className="shrink-0 px-4 pt-3">{toolbar}</div> : null}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
};
