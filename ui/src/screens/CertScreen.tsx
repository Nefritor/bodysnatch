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
  // причина неудачи и готовая команда для терминала (macOS, если системное окно не удалось показать)
  const [fail, setFail] = useState<{ error?: string; manual?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const install = async () => {
    setPhase('installing');
    try {
      setFail(null);
      const r = await api.certInstall();
      if (r && r.ok === false) {
        setFail({ error: r.error, manual: r.manual });
        setPhase('error');
      } else setPhase('idle');
    } catch {
      setFail({ error: 'нет ответа от системы' });
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

      {fail && !trusted ? (
        <div className="lg-soft flex flex-col gap-1.5 rounded-lg px-3 py-2 text-xs text-ink-soft" role="status">
          <span className="text-warn">Не удалось установить{fail.error ? `: ${fail.error}` : ''}.</span>
          {fail.manual ? (
            <>
              <span>Можно выполнить в терминале вручную (потребуется пароль), затем нажать «Далее»:</span>
              <div className="flex items-start gap-2">
                <code className="selectable min-w-0 flex-1 rounded-md bg-field px-2 py-1 font-mono text-[11px] break-all text-ink">
                  {fail.manual}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(fail.manual ?? '').then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? 'Скопировано' : 'Копировать'}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

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
