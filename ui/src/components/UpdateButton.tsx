/**
 * Кнопка обновления в шапке (слева от переключателя темы).
 *
 *   доступна версия → «Обновить» → клик → скачивание (полоска прогресса внизу кнопки)
 *   → кнопка зеленеет, на миг проявляется галочка → «Установить» → клик → окно закрывается,
 *   запускается установщик.
 *
 * Все подписи лежат в одной ячейке сетки и меняются по прозрачности, поэтому кнопка занимает
 * ширину самой длинной из них и на протяжении всех шагов ширины не меняет.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '../ui/cn.js';
import { useUpdate } from '../lib/useUpdate.js';
import { megabytes } from '../lib/format.js';

const icon = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 };

const IconRefresh = () => (
  <svg {...icon} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
    <path d="M12.6 1.6v2.8H9.8" />
  </svg>
);

const IconInstall = () => (
  <svg {...icon} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M8 2v8M4.8 7.2L8 10.4l3.2-3.2" />
    <path d="M2.8 13h10.4" />
  </svg>
);

const IconCheck = () => (
  <svg {...icon} width={15} height={15} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3.4 8.4l3 3 6.2-6.6" />
  </svg>
);

/** Слой подписи: все слои в одной ячейке, виден один. */
const Layer = ({ show, children }: { show: boolean; children: React.ReactNode }) => (
  <span
    className={cn(
      'col-start-1 row-start-1 flex items-center justify-center gap-1.5 whitespace-nowrap transition-opacity duration-300',
      show ? 'opacity-100' : 'pointer-events-none opacity-0',
    )}
    aria-hidden={!show}
  >
    {children}
  </span>
);

/** Сколько держится галочка после окончания загрузки. */
const CHECK_MS = 1000;

export const UpdateButton = () => {
  const { state, download, install } = useUpdate();
  const status = state?.status ?? 'idle';

  // «галочка» показывается только когда загрузка закончилась на наших глазах
  const [check, setCheck] = useState(false);
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (status === 'downloading') wasDownloading.current = true;
    if (status === 'ready' && wasDownloading.current) {
      wasDownloading.current = false;
      setCheck(true);
      const t = window.setTimeout(() => setCheck(false), CHECK_MS);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [status]);

  if (!state || status === 'idle') return null;

  const ready = status === 'ready';
  const mb = (n: number) => megabytes(n);
  const totalText = mb(state.total);
  // цифры одной ширины и добивка до длины итога: подпись не «пляшет» по мере роста чисел
  const pad = (text: string, size: number) => text.padStart(size, ' ');
  const receivedText = pad(mb(state.received), totalText.length);
  const speedText = pad(mb(state.speed), 4);

  const title =
    status === 'available'
      ? `Доступна версия ${state.version}`
      : status === 'downloading'
        ? `Скачивание версии ${state.version}: ${Math.round(state.progress * 100)}%`
        : ready
          ? `Версия ${state.version} скачана. Приложение закроется и запустит установщик`
          : `Не удалось скачать: ${state.error || 'ошибка'}. Нажмите, чтобы повторить`;

  const onClick = () => {
    if (status === 'available' || status === 'error') download();
    else if (ready && !check) install();
  };

  /** «Скачано / всего МБ», справа скорость — она показывается, только если в шапке хватает места. */
  const progressLabel = (received: string, speed: string) => (
    <span className="tabular-nums">
      {received} / {totalText} МБ
      <span className="hidden @[580px]:inline"> · {speed} МБ/с</span>
    </span>
  );

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={status === 'downloading' || check}
      className={cn(
        'lg-pill relative mr-1 inline-grid h-7 items-center overflow-hidden rounded-pill px-3 text-xs font-semibold',
        'transition-colors duration-500',
        ready ? 'border-good/45 bg-good-soft text-good' : status === 'error' ? 'text-bad' : 'text-brand',
        status === 'downloading' && 'cursor-progress',
      )}
    >
      {/* невидимая подпись самой большой длины: она задаёт ширину кнопки на все шаги */}
      <span aria-hidden className="invisible col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap">
        <IconInstall />
        {progressLabel(totalText, '99,9')}
      </span>
      <Layer show={status === 'available'}>
        <IconRefresh />
        Обновить до {state.version}
      </Layer>
      <Layer show={status === 'downloading'}>
        <IconInstall />
        {progressLabel(receivedText, speedText)}
      </Layer>
      <Layer show={check}>
        <IconCheck />
      </Layer>
      <Layer show={ready && !check}>
        <IconInstall />
        Установить {state.version}
      </Layer>
      <Layer show={status === 'error'}>
        <IconRefresh />
        Повторить
      </Layer>

      {/* индикатор прогресса: тонкая полоска по нижней кромке на всю ширину кнопки */}
      <span
        aria-hidden
        className={cn(
          'absolute bottom-0 left-0 h-[3px] bg-current transition-[width,opacity] duration-200 ease-out',
          status === 'downloading' ? 'opacity-90' : 'opacity-0',
        )}
        style={{ width: `${Math.round((status === 'downloading' ? state.progress : ready ? 1 : 0) * 100)}%` }}
      />
    </button>
  );
};
