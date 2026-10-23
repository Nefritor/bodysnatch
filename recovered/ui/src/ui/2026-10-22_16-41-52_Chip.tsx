/** Плашка-переключатель: используется для маски сайта и модулей. */
import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type ChipProps = {
  active?: boolean;
  /** почти неактивна — значение доступно, но выбрано другое */
  dimmed?: boolean;
  title?: string;
  onClick?: () => void;
  /** круглая кнопка-иконка вместо текста */
  shape?: 'pill' | 'round';
  className?: string;
  children?: ReactNode;
};

const base =
  'inline-flex shrink-0 items-center justify-center gap-0.5 whitespace-nowrap rounded-pill border text-xs transition-colors';

const tones = {
  on: 'border-good/35 bg-good-soft text-good',
  off: 'border-ink/12 bg-field text-ink-soft hover:bg-hover hover:text-ink',
  dim: 'border-glass-line bg-glass text-ink-subtle hover:bg-hover',
};

/** Отступы зависят от формы: у круглой кнопки их нет, иначе иконка сжимается. */
const shapes = {
  pill: 'px-2.5 py-0.5',
  round: 'size-6 p-0',
};

export const Chip = ({ active, dimmed, title, onClick, shape = 'pill', className, children }: ChipProps) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={cn(base, shapes[shape], active ? tones.on : dimmed ? tones.dim : tones.off, className)}
  >
    {children}
  </button>
);
