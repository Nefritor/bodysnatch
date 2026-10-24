/** Поле ввода: одна форма, размер задаётся свойством. */
import type { InputHTMLAttributes } from 'react';
import { cn } from './cn.js';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** xs — компактное поле внутри строки */
  scale?: 'xs' | 'md';
};

const base =
  'lg-soft rounded-(--radius-input) text-ink outline-none placeholder:text-placeholder ' +
  'focus:ring-2 focus:ring-brand/30';

const sizes = {
  xs: 'px-2.5 py-1 text-xs',
  md: 'w-full px-4 py-2 text-sm',
};

export const Input = ({ scale = 'md', className, ...rest }: InputProps) => (
  <input className={cn(base, sizes[scale], className)} spellCheck={false} {...rest} />
);
