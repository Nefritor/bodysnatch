/**
 * Своя шапка окна: системной нет. Слева название, справа выбор темы,
 * «свернуть» и «закрыть в трей».
 */
import { api } from '../api.js';
import { cn } from '../ui/cn.js';
import { ThemeMenu } from './ThemeMenu.js';

export type TitleBarProps = {
  /** подмена работает — влияет только на подпись кнопки закрытия */
  running: boolean;
};

const tbButton =
  'grid size-8 place-items-center  text-ink-soft transition-colors hover:bg-[var(--c-row-hover)] hover:text-ink';

export const TitleBar = ({ running }: TitleBarProps) => (
  <div
    className="flex h-9 shrink-0 items-center gap-2 pl-3 select-none"
    onMouseDown={(e) => {
      if (e.button === 0) api.shell('drag');
    }}
  >
    <img className="size-4" src="./logo.png" alt="" aria-hidden />
    <span className="text-xs font-semibold text-ink-soft">BodySnatch Desktop</span>
    <div className="ml-auto flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
      <ThemeMenu />
      <button type="button" className={cn(tbButton, 'rounded-bl-sm')} title="Свернуть в панель задач" onClick={() => api.shell('minimize')}>
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
          <rect x="1" y="5" width="9" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={cn(tbButton, 'hover:bg-bad hover:text-white')}
        title={running ? 'Закрыть в трей — подмена продолжит работать' : 'Закрыть в трей'}
        onClick={() => api.shell('close')}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
          <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>
    </div>
  </div>
);
