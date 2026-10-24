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
          Чтобы подменять файлы на HTTPS-сайтах, установите корневой сертификат BodySnatch. Он нужен только для сайтов
          из ваших масок. Firefox хранит сертификаты отдельно: включите в about:config параметр
          security.enterprise_roots.enabled.
        </p>

        <div className="w-fit lg-soft rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">Корневой сертификат BodySnatch</span>
            {trusted ? (
              <IconSealCheck size={18} className="text-good" />
            ) : (
              <IconWarning size={18} className="text-warn" />
            )}
          </div>
          <div className="mt-0.5 flex flex-col gap-0.5 text-xs text-ink-muted">
            <span>
              {trusted
                ? snap.platform === 'darwin'
                  ? 'установлен в связку ключей «Вход»'
                  : 'установлен в «Доверенные корневые центры»'
                : 'ещё не установлен'}
            </span>
            <div className="font-mono selectable">отпечаток: {snap.cert.thumbprint}</div>
            <span>
              {snap.cert.constraints.constrained
                ? `ограничен доменами: ${snap.cert.constraints.domains.join(', ')}`
                : 'без ограничений по доменам'}
            </span>
          </div>
        </div>
      </div>

      {snap.cert.constraints.uncovered.length ? (
        <p className="text-sm text-warn" role="status">
          Маски вышли за пределы сертификата ({snap.cert.constraints.uncovered.join(', ')}): эти сайты не будут
          подменяться. Перевыпустите сертификат.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {trusted || snap.cert.constraints.uncovered.length || snap.cert.constraints.canTighten ? (
          <Button
            variant="secondary"
            disabled={busy}
            title="Убрать сертификат из системы и удалить ключ; приложение закроется"
            onClick={() =>
              window.confirm(
                'Сертификат будет удалён, приложение закроется. При следующем запуске создастся новый, ограниченный доменами из масок, и его нужно будет установить.',
              ) && void api.certReset()
            }
          >
            {snap.cert.constraints.uncovered.length || snap.cert.constraints.canTighten
              ? 'Перевыпустить сертификат'
              : 'Удалить сертификат'}
          </Button>
        ) : null}
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
