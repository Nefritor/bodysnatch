/** Шаг 1: системный прокси. Бейдж состояния — в заголовке, вместо свитча кнопка. */
import type { Snapshot } from '../types.js';

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
    <div className="card">
      <div className="head-row">
        <h1>Прокси</h1>
        <span className={`badge ${ours ? 'badge-ok' : 'badge-bad'}`}>
          {ours ? `слушаем ${address}` : 'выключен'}
        </span>
      </div>
      <p className="muted">
        Подмена идёт через системный прокси. Включите его — и браузеры начнут получать локальные файлы вместо серверных.
      </p>

      {notice ? (
        <p className="warn" style={{ marginTop: 10 }} role="status">
          {notice}
        </p>
      ) : null}

      <div className="actions right">
        <button className={`btn ${ours ? '' : 'primary'}`} onClick={ours ? onDisable : onEnable} disabled={busy}>
          {ours ? 'Отключить прокси' : 'Включить прокси'}
        </button>
        <button className="btn primary" onClick={onNext} disabled={!ours}>
          Далее
        </button>
      </div>
    </div>
  );
};
