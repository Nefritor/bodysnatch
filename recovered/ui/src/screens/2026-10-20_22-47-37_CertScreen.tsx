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
      <div className="content">
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
            <div>
              {trusted ? 'установлен в «Доверенные корневые центры»' : 'ещё не установлен'}
            </div>
            <div>отпечаток: {snap.cert.thumbprint}</div>
          </div>
        </div>
      </div>
      <div className="footer">
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
    </div>
  );
};
