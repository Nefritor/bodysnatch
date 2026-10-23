/** Поле ввода: одна форма, размер задаётся свойством. */
import type { InputHTMLAttributes } from 'react';
import { cn } from './cn.js';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** xs — компактное поле внутри строки */
  scale?: 'xs' | 'md';
};

const base =
  'rounded-[var(--radius-input)] border border-glass-line bg-glass text-ink backdrop-blur-md ' +
  'shadow-[0_1px_2px_rgb(16_24_40_/_6%),inset_0_1px_0_rgb(255_255_255_/_35%)] ' +
  'outline-none placeholder:text-ink-subtle focus:border-brand/45 focus:ring-2 focus:ring-brand/20';

const sizes = {
  xs: 'px-2.5 py-1 text-xs',
  md: 'w-full px-4 py-2 text-sm',
};

export const Input = ({ scale = 'md', className, ...rest }: InputProps) => (
  <input className={cn(base, sizes[scale], className)} spellCheck={false} {...rest} />
);
