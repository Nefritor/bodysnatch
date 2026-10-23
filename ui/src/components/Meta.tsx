/** Подвал внутри карточки: агент и расширение с точками состояния. */
import { cn } from '../ui/cn.js';

export type MetaProps = {
  agentOk: boolean;
  extensionVersion?: string | null;
  helloBrowser?: string | null;
};

const dot = (ok: boolean) => cn('mr-1 inline-block size-2 rounded-full', ok ? 'bg-good' : 'bg-bad');

export const Meta = ({ agentOk, extensionVersion, helloBrowser }: MetaProps) => (
  <div className="flex flex-wrap items-center gap-2 text-xs">
    <span className={agentOk ? 'text-good' : 'text-warn'}>
      <span className={dot(agentOk)} /> {agentOk ? 'агент работает' : 'агент не отвечает'}
    </span>
    <span className="text-ink-subtle">·</span>
    <span className={extensionVersion ? 'text-good' : 'text-ink-muted'}>
      <span className={dot(Boolean(extensionVersion))} />{' '}
      {extensionVersion ? `расширение активно${helloBrowser ? ` в ${helloBrowser}` : ''}` : 'расширение не отвечает'}
    </span>
  </div>
);
