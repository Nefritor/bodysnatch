/**
 * Кнопка темы в шапке: дропдаун с семействами стекла и переключателем режима.
 * Правый верхний угол дропдауна — переключатель светлая/тёмная.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../ui/cn.js';
import { IconCheck } from './icons.js';
import { applyTheme, FAMILIES, loadTheme, type Theme, type ThemeFamily } from '../theme.js';

const SunIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
  </svg>
);

const MoonIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M20 14.5A8.2 8.2 0 1 1 10 4.2a6.6 6.6 0 0 0 10 10.3Z" />
  </svg>
);

export const ThemeMenu = () => {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // применяем тему при старте и при каждом изменении
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (family: ThemeFamily) => setTheme((t) => ({ ...t, family }));
  const toggleMode = () => setTheme((t) => ({ ...t, mode: t.mode === 'dark' ? 'light' : 'dark' }));
  const current = FAMILIES.find((f) => f.id === theme.family)?.label ?? 'Neutral';

  return (
    <div className="relative" ref={boxRef} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        title={`Тема: ${current} (${theme.mode === 'dark' ? 'тёмная' : 'светлая'})`}
        aria-label="Тема оформления"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-b-sm px-2 text-xs text-ink-soft transition-colors mr-2',
          'hover:bg-hover hover:text-ink',
          open && 'bg-hover text-ink',
        )}
      >
        <span className="font-medium">{current}</span>
        {theme.mode === 'dark' ? <MoonIcon /> : <SunIcon />}
      </button>

      {open ? (
        <div
          className={cn(
            'absolute right-0 z-50 mt-2 flex w-64 flex-col overflow-hidden rounded-panel border border-surface-line bg-glass',
            'max-h-[calc(100vh-48px)] shadow-matte',
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-glass-line px-3 py-2">
            <span className="text-xs font-semibold text-ink">Тема</span>
            <div className="flex items-center gap-0.5 rounded-pill border border-glass-line bg-field p-0.5">
              <button
                type="button"
                onClick={() => setTheme((t) => ({ ...t, mode: 'light' }))}
                title="Светлая"
                aria-pressed={theme.mode === 'light'}
                className={cn(
                  'grid size-6 place-items-center rounded-pill transition-colors',
                  theme.mode === 'light' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink',
                )}
              >
                <SunIcon />
              </button>
              <button
                type="button"
                onClick={() => setTheme((t) => ({ ...t, mode: 'dark' }))}
                title="Тёмная"
                aria-pressed={theme.mode === 'dark'}
                className={cn(
                  'grid size-6 place-items-center rounded-pill transition-colors',
                  theme.mode === 'dark' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink',
                )}
              >
                <MoonIcon />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto p-2">
            {FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => pick(f.id)}
                aria-pressed={theme.family === f.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-btn border px-2 py-1.5 text-left text-xs transition-colors',
                  theme.family === f.id
                    ? 'border-brand/35 bg-brand-soft text-ink'
                    : 'border-transparent text-ink-soft hover:bg-hover hover:text-ink',
                )}
              >
                <span
                  aria-hidden
                  className="size-3.5 shrink-0 rounded-full border border-glass-line"
                  style={{
                    background:
                      f.id === 'neutral'
                        ? 'linear-gradient(165deg,#f8f9fb,#dfe3ea)'
                        : f.id === 'slate'
                          ? 'linear-gradient(165deg,#f3f5f8,#c9d0da)'
                          : f.id === 'sand'
                            ? 'linear-gradient(165deg,#faf8f4,#e0d6c6)'
                            : f.id === 'ink'
                              ? 'linear-gradient(165deg,#eef1f6,#b9c2d4)'
                              : 'linear-gradient(165deg,#f5f4f1,#d5d1cb)',
                  }}
                />
                <span className="flex-1">{f.label}</span>
                {theme.family === f.id ? <IconCheck size={13} className="text-brand" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
