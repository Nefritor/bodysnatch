/**
 * Своя шапка окна. Слева название, справа выбор темы, «свернуть» и «закрыть».
 * Окно перетаскивается за шапку средствами Chromium (`app-region`).
 * На macOS системные кнопки остаются слева, поэтому свои не рисуем.
 */
import { api } from '../api.js';
import { cn } from '../ui/cn.js';
import { ThemeMenu } from './ThemeMenu.js';
import { UpdateButton } from './UpdateButton.js';

export type TitleBarProps = {
  /** подмена работает — влияет только на подпись кнопки закрытия */
  running: boolean;
  /** текущая версия приложения */
  version?: string;
};

const tbButton =
  'grid size-8 w-12 place-items-center text-ink-soft transition-colors hover:bg-[var(--c-row-hover)] hover:text-ink';

export const TitleBar = ({ running, version }: TitleBarProps) => {
  const mac = api.platform() === 'darwin';
  return (
    <div
      className={cn(
        '@container flex h-10 shrink-0 items-center gap-2 select-none [-webkit-app-region:drag]',
        mac ? 'pl-20' : 'pl-3',
      )}
    >
      <img className="size-4" src="./logo.png" alt="" aria-hidden />
      <span className="text-xs font-semibold text-ink-soft">BodySnatch</span>
      {version ? <span className="text-[11px] text-ink-muted">v{version}</span> : null}
      <div className="ml-auto flex h-full items-center [-webkit-app-region:no-drag]">
        <UpdateButton />
        <ThemeMenu />
        {mac ? null : (
          <>
            <button
              type="button"
              className={cn(tbButton, 'self-start rounded-bl-sm')}
              title="Свернуть"
              onClick={() => api.shell('minimize')}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
                <rect x="1" y="5" width="9" height="1" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className={cn(tbButton, 'self-start hover:bg-close hover:text-white')}
              title={running ? 'Свернуть в трей' : 'Закрыть'}
              onClick={() => api.shell('close')}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
                <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
