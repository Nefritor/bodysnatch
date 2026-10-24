/**
 * Плавно раскрывающийся блок: высота анимируется через grid-template-rows (0fr → 1fr),
 * без измерения содержимого и без перекладки соседей на каждый кадр JS.
 */
import type { ReactNode, Ref } from 'react';
import { cn } from './cn.js';

export type CollapsibleProps = {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** внутренний контейнер: по его scrollHeight считается высота раскрытого блока */
  innerRef?: Ref<HTMLDivElement>;
};

export const Collapsible = ({ open, children, className, innerRef }: CollapsibleProps) => (
  <div
    className={cn(
      'grid transition-[grid-template-rows,opacity] duration-[320ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
      open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      className,
    )}
    // закрытый блок не должен получать фокус клавиатурой
    inert={!open}
  >
    <div ref={innerRef} className="min-h-0 overflow-hidden">
      {children}
    </div>
  </div>
);
