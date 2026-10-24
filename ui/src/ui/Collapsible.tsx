/**
 * Раскрывающийся блок. Содержимое остаётся в дереве и в закрытом виде (grid 0fr), поэтому
 * его естественную высоту можно измерить заранее и подогнать под неё окно.
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
    className={cn('grid', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]', className)}
    // закрытый блок не должен получать фокус клавиатурой
    inert={!open}
  >
    <div ref={innerRef} className="-mx-1.5 min-h-0 overflow-hidden px-1.5">
      {children}
    </div>
  </div>
);
