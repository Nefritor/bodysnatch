/**
 * Свитч в стиле iOS: дорожка + круглая «таблетка».
 * Кликабельна вся область вокруг дорожки, а не только она сама.
 */
import { cn } from '../ui/cn.js';

export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** доступное имя для скринридера и подсказки */
  label?: string;
  title?: string;
  disabled?: boolean;
};

export const Switch = ({ checked, onChange, label, title, disabled }: SwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    title={title ?? label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn(
      'group -m-1 inline-flex shrink-0 items-center rounded-pill border border-transparent p-1',
      'disabled:cursor-default disabled:opacity-55',
    )}
  >
    <span
      className={cn(
        'relative inline-flex h-7 w-12 items-center rounded-pill border transition-colors duration-200',
        checked ? 'border-good/35 bg-good' : 'border-glass-line bg-[var(--c-row-hover)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute size-5 rounded-full bg-white shadow-[0_1px_2px_rgba(16,19,26,.28)] transition-all duration-200',
          checked ? 'left-6' : 'left-1',
        )}
      />
    </span>
  </button>
);
