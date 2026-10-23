/**
 * Тема: авто (как в системе), светлая или тёмная. Хранится в localStorage,
 * применяется атрибутом data-mode на <html>.
 */
export type ThemeMode = 'auto' | 'light' | 'dark';

const KEY = 'bodysnatch.theme';
const MODES: ThemeMode[] = ['auto', 'light', 'dark'];

export const loadTheme = (): ThemeMode => {
  try {
    const raw = localStorage.getItem(KEY);
    return MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : 'auto';
  } catch {
    return 'auto';
  }
};

export const nextTheme = (mode: ThemeMode): ThemeMode => MODES[(MODES.indexOf(mode) + 1) % MODES.length];

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export const applyTheme = (mode: ThemeMode) => {
  document.documentElement.dataset.mode = mode === 'auto' ? (systemDark() ? 'dark' : 'light') : mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* приватный режим — просто не сохраняем */
  }
};
