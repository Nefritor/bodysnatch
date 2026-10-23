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
const ROW = 'grid grid-cols-[74px_72px_160px_minmax(0,1fr)] items-center gap-2 px-3';

/** Высота раскрытых блоков: окно подгоняется под них (см. change). */
const RULES_H = 590;
const QUERIES_H = 260;
/** Пауза между командой окну «расти» и перерисовкой содержимого: иначе кадр рисуется в тесном окне. */
const GROW_DELAY_MS = 90;

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

  const work = STEPS.find(({ key }) => key === Step.Work)?.size ?? { w: 600, h: 222 };
  const resizeTo = (rules: boolean, queries: boolean) =>
    api.shell('resize', { w: work.w, h: work.h + (rules ? RULES_H : 0) + (queries ? QUERIES_H : 0) });

  // Раскрытие без мигания: сначала окно растёт, и только потом рисуется содержимое;
  // при сворачивании — наоборот. Так блок не рисуется в окне, которое ему ещё мало.
  const change = (rules: boolean, queries: boolean) => {
    const grow = (rules && !rulesOpen) || (queries && !queriesOpen);
    const apply = () => {
      setRulesOpen(rules);
      setQueriesOpen(queries);
    };
    if (grow && api.hasNativeShell()) {
      resizeTo(rules, queries);
      window.setTimeout(apply, GROW_DELAY_MS);
    } else {
      apply();
      resizeTo(rules, queries);
    }
  };

  // начальный размер рабочего экрана
  useEffect(() => resizeTo(false, false), []); // eslint-disable-line react-hooks/exhaustive-deps

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
          'rounded-window border border-glass-line bg-nested px-4 py-2 shadow-glass',
          'backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturate)',
        )}
      >
        <button
          type="button"
          className={cn(
            '-mx-1 flex w-[calc(100%+8px)] items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left',
            'text-[15px] font-semibold text-brand hover:bg-hover',
          )}
          onClick={() => change(!rulesOpen, queriesOpen)}
          aria-expanded={rulesOpen}
        >
          {caret(rulesOpen)}
          Правила подмены
        </button>
        {rulesOpen ? (
          <div className="pt-2" style={{ height: RULES_H }}>
            <div className="h-full">{rulesSlot}</div>
          </div>
        ) : null}
      </section>

      <section
        className={cn(
          'border border-b-0 border-glass-line bg-nested shadow-glass',
          'backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturate)',
          'mt-auto -ml-[11px] w-[calc(100%+22px)] px-4 pt-2 pb-4',
        )}
      >
        <button
          type="button"
          className={cn(
            '-mx-1 flex w-[calc(100%+8px)] items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left',
            'text-[15px] font-semibold text-brand hover:bg-hover',
          )}
          onClick={() => change(rulesOpen, !queriesOpen)}
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
                placeholder="Поиск по журналу"
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
                      'rounded-pill border px-2.5 py-1 text-xs',
                      filter === key
                        ? 'border-brand/25 bg-brand-soft font-semibold text-brand'
                        : 'border-glass-line bg-field text-ink-muted hover:bg-glass-strong',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={onClearLog}
                disabled={log.length === 0}
                title="Очистить журнал"
              >
                <IconClose size={11} />
                Очистить
              </Button>
            </div>

            <div className="h-[200px] overflow-auto rounded-md border border-glass-line bg-nested">
              {rows.length === 0 ? (
                <div className="grid h-full place-items-center text-xs text-ink-muted">Пусто</div>
              ) : (
                <>
                  <div
                    className={cn(
                      ROW,
                      'sticky top-0 z-10 border-b border-glass-line bg-surface py-1.5',
                      'text-[11px] font-semibold tracking-wide text-ink-muted uppercase',
                    )}
                  >
                    <span>Время</span>
                    <span>Статус</span>
                    <span>{filter === 'mirror' ? 'Модуль' : 'Тип'}</span>
                    <span>{filter === 'mirror' ? 'Локальный файл' : 'Файл или адрес'}</span>
                  </div>
                  {rows.map((e, i) => (
                    <div
                      key={e.id ?? `${e.t}-${i}`}
                      className={cn(ROW, 'border-b border-line py-1 text-xs last:border-0')}
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
                </>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
};
