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

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/**
 * Сменить тему одним общим кроссфейдом всей страницы (View Transitions).
 * У элементов разные собственные переходы, а градиентные фоны плавно менять цвет не умеют,
 * поэтому раньше часть интерфейса «опаздывала». Здесь браузер снимает старый и новый вид страницы
 * и плавно смешивает их целиком; на время смены индивидуальные переходы отключены (см. theme.css).
 * `commit` вызывается внутри смены и должен синхронно обновить состояние интерфейса.
 */
export const switchTheme = (mode: ThemeMode, commit: () => void) => {
  const doc = document as ViewTransitionDocument;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduce) {
    applyTheme(mode);
    commit();
    return;
  }
  const root = document.documentElement;
  root.classList.add('theme-switching');
  const transition = doc.startViewTransition(() => {
    applyTheme(mode);
    commit();
  });
  void transition.finished.finally(() => root.classList.remove('theme-switching'));
};
