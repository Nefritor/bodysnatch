/**
 * Плавно раскрывающийся блок: высота анимируется через grid-template-rows (0fr → 1fr),
 * без измерения содержимого и без перекладки соседей на каждый кадр JS.
 */
import type { ReactNode } from 'react';
import { cn } from './cn.js';

export type CollapsibleProps = {
  open: boolean;
  children: ReactNode;
  className?: string;
};

export const Collapsible = ({ open, children, className }: CollapsibleProps) => (
  <div
    className={cn(
      'grid transition-[grid-template-rows,opacity] duration-[320ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
      open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      className,
    )}
    // закрытый блок не должен получать фокус клавиатурой
    inert={!open}
  >
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>
);
