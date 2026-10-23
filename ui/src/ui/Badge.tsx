/** Бейдж состояния: форма одна, цвет задаётся тоном. */
import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type BadgeTone = 'neutral' | 'ok' | 'bad' | 'warn' | 'brand';

export type BadgeProps = {
  tone?: BadgeTone;
  /** подсказка при наведении */
  title?: string;
  className?: string;
  children: ReactNode;
};

const base =
  'inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs ' +
  'backdrop-blur-md backdrop-saturate-150';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-glass-line bg-glass-strong text-ink-soft',
  ok: 'border-good/25 bg-good-soft text-good',
  bad: 'border-bad/25 bg-bad-soft text-bad',
  warn: 'border-warn/25 bg-warn-soft text-warn',
  brand: 'border-brand/25 bg-brand-soft text-brand',
};

export const Badge = ({ tone = 'neutral', title, className, children }: BadgeProps) => (
  <span title={title} className={cn(base, tones[tone], className)}>
    {children}
  </span>
);
