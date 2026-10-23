/**
 * Тема: семейство (neutral/slate/sand/ink/stone) и режим (light/dark).
 * Хранится в localStorage, применяется атрибутами на <html>.
 */
export type ThemeFamily = 'neutral' | 'slate' | 'sand' | 'ink' | 'stone';
export type ThemeMode = 'light' | 'dark';

export type Theme = { family: ThemeFamily; mode: ThemeMode };

export const FAMILIES: { id: ThemeFamily; label: string }[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'slate', label: 'Slate' },
  { id: 'sand', label: 'Sand' },
  { id: 'ink', label: 'Ink' },
  { id: 'stone', label: 'Stone' },
];

const KEY = 'bodysnatch.theme';

const DEFAULT_THEME: Theme = { family: 'neutral', mode: 'light' };

export const loadTheme = (): Theme => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<Theme>;
    const family = FAMILIES.some((f) => f.id === parsed.family) ? (parsed.family as ThemeFamily) : 'neutral';
    const mode: ThemeMode = parsed.mode === 'dark' ? 'dark' : 'light';
    return { family, mode };
  } catch {
    return DEFAULT_THEME;
  }
};

export const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  root.dataset.theme = theme.family;
  root.dataset.mode = theme.mode;
  // сообщаем окну режим: фон формы подстраивается, иначе на скруглениях мелькает светлое
  try {
    (
      window as unknown as { chrome?: { webview?: { postMessage: (m: unknown) => void } } }
    ).chrome?.webview?.postMessage({
      bs: 'theme',
      mode: theme.mode,
    });
  } catch {
    /* в браузере окна нет */
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(theme));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
};
