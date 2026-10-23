/**
 * Кнопка: размер + цвет — два независимых набора утилит.
 * Поверхность матовая: плоская заливка, без градиентов и внутренних бликов.
 */
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const base =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-btn border font-medium ' +
  'transition-[background,box-shadow,color,border-color] duration-150 disabled:cursor-default ' +
  'disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'border-brand-deep/40 bg-brand text-[var(--c-accent-ink)] hover:bg-brand-deep active:bg-brand-deep',
  secondary:
    'border-glass-line bg-field text-ink backdrop-blur-md hover:border-ink/15 hover:bg-hover',
  danger: 'border-bad/25 bg-bad/10 text-bad hover:bg-bad/16',
  ghost: 'border-transparent bg-transparent text-ink-soft hover:bg-hover',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
};

export const Button = ({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) => (
  <button type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest} />
);
