/** Круговой индикатор загрузки. */
import { cn } from '../ui/cn.js';

export type SpinnerProps = {
  /** big — крупный вариант для экранов ожидания */
  size?: 'normal' | 'big';
};

export const Spinner = ({ size = 'normal' }: SpinnerProps) => (
  <span
    role="status"
    aria-label="загрузка"
    className={cn(
      'inline-block animate-spin rounded-full border-2 border-brand/25 border-t-brand',
      size === 'big' ? 'size-7' : 'size-3.5',
    )}
  />
);
