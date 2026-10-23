/** Шаг системного прокси. Состояние — бейджем в заголовке, действие — кнопкой. */
import type { Snapshot } from '../types.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';

export type ProxyScreenProps = {
  snap: Snapshot;
  busy: boolean;
  /** текст последней ошибки */
  notice: string;
  onEnable: () => void;
  onDisable: () => void;
  onNext: () => void;
};

export const ProxyScreen = ({ snap, busy, notice, onEnable, onDisable, onNext }: ProxyScreenProps) => {
  const ours = snap.systemProxy.ours;
  const address = `127.0.0.1:${snap.port}`;

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">Прокси</h1>
          <Badge tone={ours ? 'ok' : 'bad'}>{ours ? `слушаем ${address}` : 'выключен'}</Badge>
        </div>
        <p className="text-sm text-ink-muted">
          Подмена идёт через системный прокси. Включите его — и браузеры начнут получать локальные файлы вместо
          серверных.
        </p>

        {notice ? (
          <p className="text-sm text-warn" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant={ours ? 'secondary' : 'primary'} onClick={ours ? onDisable : onEnable} disabled={busy}>
          {ours ? 'Отключить прокси' : 'Включить прокси'}
        </Button>
        <Button variant="primary" onClick={onNext} disabled={!ours}>
          Далее
        </Button>
      </div>
    </div>
  );
};
