/** Стеклянная панель и её шапка. Матовое стекло: размытие, без бликов и градиентов. */
import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type PanelProps = {
  /** без собственного стекла — когда панель вложена в другую */
  flat?: boolean;
  className?: string;
  children: ReactNode;
};

export const Panel = ({ flat, className, children }: PanelProps) => (
  <section
    className={cn(
      'flex flex-col gap-2 rounded-panel border border-glass-line pt-3 p-4',
      flat
        ? 'bg-transparent'
        : 'bg-glass shadow-matte backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]',
      className,
    )}
  >
    {children}
  </section>
);

export type PanelHeadProps = {
  className?: string;
  children: ReactNode;
};

export const PanelHead = ({ className, children }: PanelHeadProps) => (
  <div className={cn('flex flex-wrap items-baseline gap-2', className)}>{children}</div>
);

export const PanelTitle = ({ children }: { children: ReactNode }) => (
  <span className="flex grow h-6 font-semibold text-ink gap-3 items-baseline">{children}</span>
);

export const PanelHint = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-xs text-ink-muted">{children}</span>
);
