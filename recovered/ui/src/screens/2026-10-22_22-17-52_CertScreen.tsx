/** Шаг сертификата. Установка идёт через помощника с запросом прав. */
import { useState } from 'react';
import { api } from '../api.js';
import type { Snapshot } from '../types.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { IconSeal, IconSealCheck, IconWarning } from '../components/icons.js';

export type CertScreenProps = {
  snap: Snapshot;
  busy: boolean;
  onNext: () => void;
};

export const CertScreen = ({ snap, busy, onNext }: CertScreenProps) => {
  const trusted = snap.cert.trusted;
  const [phase, setPhase] = useState<'idle' | 'installing' | 'error'>('idle');

  const install = async () => {
    setPhase('installing');
    try {
      const r = await api.certInstall();
      setPhase(r && r.ok === false ? 'error' : 'idle');
    } catch {
      setPhase('error');
    }
  };

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">Сертификат для HTTPS</h1>
          <Badge tone={trusted ? 'ok' : 'bad'}>{trusted ? 'установлен' : 'не установлен'}</Badge>
        </div>
        <p className="text-sm text-ink-muted">
          Чтобы читать защищённый трафик, установите корневой сертификат BodySnatch
        </p>

        <div className="w-fit rounded-md border border-glass-line bg-nested px-4 py-2.5 backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]">
          <div className="flex items-center gap-1">
            {trusted ? (
              <IconSealCheck size={18} className="text-good" />
            ) : (
              <IconWarning size={18} className="text-warn" />
            )}
            <span className="text-sm font-semibold text-ink">Корневой сертификат BodySnatch</span>
          </div>
          <div className="mt-0.5 flex flex-col gap-0.5 text-xs text-ink-muted">
            <span>{trusted ? 'установлен в «Доверенные корневые центры»' : 'ещё не установлен'}</span>
            <div className="font-mono selectable">отпечаток: {snap.cert.thumbprint}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {!trusted ? (
          <Button variant="primary" onClick={() => void install()} disabled={busy || phase === 'installing'}>
            {phase === 'installing' ? 'Устанавливаем…' : 'Установить сертификат'}
          </Button>
        ) : null}
        <Button variant="primary" onClick={onNext}>
          Далее
        </Button>
      </div>
    </div>
  );
};