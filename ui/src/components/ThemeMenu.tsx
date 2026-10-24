/**
 * Кнопка темы в шапке: авто → светлая → тёмная.
 * Призрачный стиль: виден только текст, при наведении проявляется стеклянная пилюля.
 * Подписи лежат в одной ячейке сетки, поэтому ширина кнопки не меняется при смене темы.
 */
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { applyTheme, loadTheme, nextTheme, switchTheme, type ThemeMode } from '../theme.js';
import { cn } from '../ui/cn.js';

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'auto', label: 'Авто' },
  { mode: 'light', label: 'Светлая' },
  { mode: 'dark', label: 'Тёмная' },
];

const icon = (mode: ThemeMode) => {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
  };
  if (mode === 'dark')
    return (
      <svg {...common} aria-hidden>
        <path d="M20 14.5A8.2 8.2 0 1 1 10 4.2a6.6 6.6 0 0 0 10 10.3Z" />
      </svg>
    );
  if (mode === 'light')
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
      </svg>
    );
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" fill="currentColor" />
    </svg>
  );
};

export const ThemeMenu = () => {
  const [mode, setMode] = useState<ThemeMode>(() => loadTheme());

  useEffect(() => {
    applyTheme(mode);
    if (mode !== 'auto') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => switchTheme('auto', () => undefined);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  const current = MODES.find((m) => m.mode === mode)?.label ?? '';

  return (
    <button
      type="button"
      aria-label="Тема оформления"
      title={`Тема: ${current}`}
      onClick={() => {
        const next = nextTheme(mode);
        switchTheme(next, () => flushSync(() => setMode(next)));
      }}
      className={cn(
        'mr-1 inline-grid h-7 items-center rounded-pill border border-transparent px-2.5 text-xs font-medium',
        'text-ink-soft transition-[background-color,border-color,box-shadow,color] duration-200 hover:text-ink',
        // при наведении проявляется стеклянная пилюля
        'hover:border-[var(--lg-hair)] hover:bg-[var(--lg-fill-hover)]',
        'hover:shadow-[inset_0_1px_0_var(--lg-edge),0_4px_12px_rgb(20_26_40/8%)]',
      )}
    >
      {MODES.map((m) => (
        <span
          key={m.mode}
          aria-hidden={m.mode !== mode}
          className={cn(
            'col-start-1 row-start-1 flex items-center justify-center gap-1.5 whitespace-nowrap',
            m.mode === mode ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          {m.label}
          {icon(m.mode)}
        </span>
      ))}
    </button>
  );
};
