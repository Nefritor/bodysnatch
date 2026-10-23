/** Кнопка темы в шапке: авто → светлая → тёмная. */
import { useEffect, useState } from 'react';
import { applyTheme, loadTheme, nextTheme, type ThemeMode } from '../theme.js';

const LABEL: Record<ThemeMode, string> = { auto: 'Авто', light: 'Светлая', dark: 'Тёмная' };

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
    const onChange = () => applyTheme('auto');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [mode]);

  return (
    <button
      type="button"
      aria-label="Тема оформления"
      title={`Тема: ${LABEL[mode]}`}
      onClick={() => setMode(nextTheme(mode))}
      className="mr-2 flex h-8 items-center gap-1.5 rounded-b-sm px-2 text-xs text-ink-soft transition-colors hover:bg-hover hover:text-ink"
    >
      <span className="font-medium">{LABEL[mode]}</span>
      {icon(mode)}
    </button>
  );
};
