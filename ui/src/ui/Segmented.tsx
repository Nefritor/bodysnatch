/**
 * Переключатель на несколько положений: «жидкий» бегунок скользит между подписями.
 * Бегунок чуть пружинит в конце хода, как в iOS.
 */
import { cn } from './cn.js';

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
  /** sm — компактный вариант для панелей инструментов */
  size?: 'sm' | 'md';
};

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  size = 'md',
}: SegmentedProps<T>) {
  const count = options.length;
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('lg-pill relative inline-grid shrink-0 rounded-pill p-[3px]', className)}
      style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}
    >
      <span
        aria-hidden
        className="lg-thumb absolute top-[3px] bottom-[3px] left-[3px] rounded-pill transition-transform duration-[380ms] [transition-timing-function:cubic-bezier(0.3,1.35,0.5,1)]"
        style={{ width: `calc((100% - 6px) / ${count})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative z-10 rounded-pill whitespace-nowrap transition-colors duration-200',
            size === 'sm' ? 'px-2.5 py-0.5 text-[11px]' : 'px-3.5 py-1 text-xs',
            o.value === value ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
