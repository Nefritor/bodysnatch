/** Шаг 2: сертификат. Установка идёт через помощника с запросом прав. */
import { useState } from 'react';
import { api } from '../api.js';
import type { Snapshot } from '../types.js';

export type CertScreenProps = {
  snap: Snapshot;
  busy: boolean;
  onNext: () => void;
};

export const CertScreen = ({ snap, busy, onNext }: CertScreenProps) => {
  const trusted = snap.cert.trusted;
  const [phase, setPhase] = useState<'idle' | 'installing' | 'error'>('idle');
  const [opened, setOpened] = useState(false);
  // rootCA.pem существует всегда — команда сработает сразу, без «Скачать .crt»
  const command = `certutil -addstore -user Root "${snap.cert.certPath}"`;

  const install = async () => {
    setPhase('installing');
    try {
      const r = await api.certInstall();
      if (r && r.ok === false) {
        setPhase('error');
      } else {
        setOpened(true);
        setPhase('idle');
      }
    } catch (e) {
      setPhase('error');
    }
  };

  return (
    <div className="card">
      <div className="head-row">
        <h1>Сертификат для HTTPS</h1>
        <span className={`badge ${trusted ? 'badge-ok' : 'badge-bad'}`}>{trusted ? 'установлен' : 'не установлен'}</span>
      </div>
      <p className="muted">
        Чтобы читать защищённый трафик, установите корневой сертификат BodySnatch
      </p>

      <div className="hint-card">
        <div className="hint-card-head">Корневой сертификат BodySnatch</div>

        <div className="hint-card-body">
          <div className="hint">
            {trusted ? 'установлен в «Доверенные корневые центры»' : 'ещё не установлен'}
          </div>
          <div className="hint">отпечаток: {snap.cert.thumbprint}</div>
        </div>
      </div>

      {!trusted && opened ? (
        <div className="note-warn" role="status">
          Открыли окно подтверждения Windows. Нажмите в нём «Да» — сертификат встанет в хранилище текущего
          пользователя, и этот экран обновится сам.
          <div className="hint" style={{ marginTop: 6 }}>
            Если вместо предупреждения открылся «Мастер импорта сертификатов» — выбирайте «Текущий пользователь» →
            «Доверенные корневые центры». Пункт «Локальный компьютер» на некоторых машинах выдаёт ошибку хранилища
            доверия предприятия.
          </div>
        </div>
      ) : null}

      {snap.lowIntegrity ? (
        <div className="note-warn" role="status">
          Приложение запущено в ограниченном режиме (песочница, низкий уровень целостности). Windows в нём запрещает
          установку сертификата и запись настроек. Закройте приложение и запустите <strong>bodysnatch.exe</strong>{' '}
          двойным щелчком в Проводнике — тогда всё установится.
        </div>
      ) : null}

      {!trusted && phase === 'installing' ? <p className="hint">Открываем окно установки сертификата…</p> : null}

      {!trusted && phase === 'error' ? (
        <p className="warn" role="status">
          Окно не открылось. Установите сертификат вручную — файл и команда ниже.
        </p>
      ) : null}

      {!trusted && snap.cert.install && snap.cert.install.code != null && snap.cert.install.code !== 0 ? (
        <p className="warn" role="status">
          Windows не принял сертификат (код {snap.cert.install.code}). Попробуйте вручную — команда ниже.
        </p>
      ) : null}

      {!trusted && snap.cert.check && snap.cert.check.at > 0 ? (
        <p className="hint" role="status">
          Проверка хранилищ: {snap.cert.check.found ? 'найден' : 'не найден'} — пользователь, машина, .NET, certutil.
          Запуск {snap.cert.elevated ? 'от администратора' : 'обычный'}.
        </p>
      ) : null}

      <div className="actions right">
        {!trusted ? (
          <button className="btn primary" onClick={() => void install()} disabled={busy || phase === 'installing'}>
            {phase === 'installing' ? 'Устанавливаем…' : 'Установить сертификат'}
          </button>
        ) : null}
        <button className="btn primary" onClick={onNext}>
          Далее
        </button>
      </div>
    </div>
  );
};
