/** Рабочий экран: свитч рядом с названием, правила и запросы — под спойлерами. */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { api } from '../api.js';
import type { LogEntry, Snapshot } from '../types.js';
import { Switch } from '../components/index.js';
import { IconChevron, IconClose } from '../components/icons.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { cn } from '../ui/cn.js';
import { Step, STEPS } from '../constants.js';
import { highlight } from '../lib/highlight.js';

export type RunningScreenProps = {
  snap: Snapshot;
  busy: boolean;
  log: LogEntry[];
  onClearLog: () => void;
  onToggle: (on: boolean) => void;
  /** готовый блок правил — показывается под спойлером */
  rulesSlot: ReactNode;
};

/** Из полного пути оставляем только хвост после модуля: `_call/Page.js`. */
const tailAfterModule = (file: string, module: string) => {
  if (!file) return '';
  const path = file.replace(/\\/g, '/');
  if (!module) return path;
  const marker = `/${module}/`;
  const at = path.toLowerCase().lastIndexOf(marker.toLowerCase());
  if (at < 0) return path;
  return path.slice(at + marker.length);
};

/** Строка таблицы: фиксированные первые три колонки, последняя — по остатку. */
const ROW = 'grid grid-cols-[74px_72px_160px_minmax(0,1fr)] items-center gap-2 px-2';

type Filter = 'mirror' | 'all' | 'errors';

export const RunningScreen = ({ snap, log, onClearLog, busy, onToggle, rulesSlot }: RunningScreenProps) => {
  const [filter, setFilter] = useState<Filter>('mirror');
  const [query, setQuery] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [queriesOpen, setQueriesOpen] = useState(false);
  // свитч отзывается мгновенно, не дожидаясь опроса состояния
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (pending !== null && snap.enabled === pending) setPending(null);
  }, [snap.enabled, pending]);
  const checked = pending ?? snap.enabled;

  // только подмены локальными файлами, последние 100, с поиском по содержимому
  const rows = useMemo(() => {
    const mirrored = log.filter((e) =>
      filter === 'mirror'
        ? e.via.startsWith('mirror') && e.file
        : filter === 'errors'
          ? e.via === 'error' || e.via === 'map-miss' || e.status >= 400
          : e.via !== 'switch',
    );
    const q = query.trim().toLowerCase();
    const filtered = q
      ? mirrored.filter((e) =>
        `${e.t} ${e.status} ${e.module || ''} ${e.file || ''} ${tailAfterModule(e.file || '', e.module || '')} ${e.url}`
          .toLowerCase()
          .includes(q),
      )
      : mirrored;
    return filtered.slice(0, 100);
  }, [log, query, filter]);

  useEffect(() => {
    const sizes = STEPS.find(({ key }) => key === Step.Work)?.size;
    if (sizes) {
      const h = sizes.h + (rulesOpen ? 590 : 0) + (queriesOpen ? 260 : 0);
      api.shell('resize', { w: sizes.w, h });
    }
  }, [rulesOpen, queriesOpen]);

  const caret = (open: boolean) => (
    <IconChevron size={14} className={cn('shrink-0 text-brand transition-transform', open && 'rotate-90')} />
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-col gap-1.5 px-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">BodySnatch</h1>
          <Switch
            checked={checked}
            onChange={(v) => {
              setPending(v);
              onToggle(v);
            }}
            label=""
            title={checked ? 'Приостановить подмену' : 'Включить подмену'}
            disabled={busy}
          />
        </div>
        <div className="text-xs text-ink-muted">
          прокси {snap.systemProxy.ours ? 'включён' : 'выключен'} · порт {snap.port} · модулей{' '}
          {Object.keys(snap.moduleRoots || {}).length} · локальных ответов {snap.stats.local}
        </div>
      </div>

      <section
        className={cn(
          'rounded-window border border-glass-line bg-nested px-4 py-2 shadow-glass transition-colors',
          'backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturate)',
          !rulesOpen && 'cursor-pointer hover:bg-hover',
        )}
        onClick={rulesOpen ? undefined : () => setRulesOpen(true)}
      >
        <button
          type="button"
          className="flex w-full items-center justify-start gap-2 rounded-sm px-1 py-1.5 text-left text-[15px] font-semibold text-brand transition-colors"
          onClick={() => setRulesOpen((v) => !v)}
          aria-expanded={rulesOpen}
        >
          {caret(rulesOpen)}
          Правила подмены
        </button>
        {rulesOpen ? (
          <div className="h-[590px] pt-2">
            <div className="h-full">{rulesSlot}</div>
          </div>
        ) : null}
      </section>

      <section
        className={cn(
          'border border-b-0 border-glass-line bg-nested shadow-glass transition-colors',
          'backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturate)',
          'mt-auto px-4 pt-2 pb-4 -ml-[11px] w-[calc(100%+22px)]',
          !queriesOpen && 'cursor-pointer hover:bg-hover',
        )}
        onClick={queriesOpen ? undefined : () => setQueriesOpen(true)}
      >
        <button
          type="button"
          className="flex w-full items-center justify-start gap-2 rounded-sm px-1 py-1.5 text-left text-[15px] font-semibold text-brand transition-colors"
          onClick={() => setQueriesOpen((v) => !v)}
          aria-expanded={queriesOpen}
        >
          {caret(queriesOpen)}
          Запросы
          <span className="ml-1 text-xs font-normal text-ink-muted">{rows.length}</span>
        </button>

        {queriesOpen ? (
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex items-center gap-2">
              <Input
                type="search"
                placeholder="Поиск по времени, статусу, модулю или пути"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="flex shrink-0 gap-1" role="group" aria-label="Фильтр журнала">
                {(
                  [
                    ['mirror', 'Подмены'],
                    ['errors', 'Ошибки'],
                    ['all', 'Все'],
                  ] as [Filter, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      'rounded-pill border px-2.5 py-1 text-xs transition-colors',
                      filter === key
                        ? 'border-brand/25 bg-brand-soft font-semibold text-brand'
                        : 'border-glass-line bg-field text-ink-muted hover:bg-glass-strong',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="grid h-[200px] place-items-center rounded-md border border-glass-line bg-nested text-xs text-ink-muted backdrop-blur-(--glass-blur)">
                Пусто
              </div>
            ) : (
              <div className="relative">
                {rows.length > 0 ? (
                  <div className="absolute top-0.75 right-3 z-20">
                    <Button size="round" variant="secondary" onClick={onClearLog} title="Очистить журнал">
                      <IconClose size={12} />
                    </Button>
                  </div>
                ) : null}
                <div className="h-[200px] overflow-auto rounded-md border border-glass-line bg-nested px-3 backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturate)">
                  <div className={cn(ROW, 'sticky top-0 z-10 py-1.5 text-xs font-semibold text-ink-muted')}>
                    <span>Время</span>
                    <span>Статус</span>
                    <span>{filter === 'mirror' ? 'Модуль' : 'Тип'}</span>
                    <span>{filter === 'mirror' ? 'Локальный файл' : 'Файл или адрес'}</span>
                  </div>
                  {rows.map((e, i) => (
                    <div
                      key={`${e.t}-${e.file}-${i}`}
                      className={cn(ROW, 'border-b border-line py-1 text-xs transition-colors last:border-0')}
                    >
                      <span className="truncate text-ink-muted">{highlight(String(e.t).slice(0, 8), query)}</span>
                      <span>
                        <Badge tone={e.status >= 200 && e.status < 400 ? 'ok' : 'bad'}>
                          {highlight(String(e.status), query)}
                        </Badge>
                      </span>
                      <span className="truncate">
                        <Badge title={e.module || e.via}>{highlight(e.module || e.via, query)}</Badge>
                      </span>
                      <span className="truncate font-mono text-ink" title={e.file || e.url}>
                        {highlight(e.file ? tailAfterModule(e.file, e.module || '') : e.note || e.url, query)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
};
