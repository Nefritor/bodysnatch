/** Рабочий экран: свитч рядом с названием, правила и запросы — под спойлерами. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { api } from '../api.js';
import type { LogEntry, Snapshot } from '../types.js';
import { Switch } from '../components/index.js';
import { IconChevron, IconClose } from '../components/icons.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { Segmented } from '../ui/Segmented.js';
import { Collapsible } from '../ui/Collapsible.js';
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

/** Длительность сворачивания блока (см. Collapsible): окно подтягивается после неё. */
const COLLAPSE_MS = 340;

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

  const lastRef = useRef<HTMLElement | null>(null);
  const rulesBody = useRef<HTMLDivElement | null>(null);
  const queriesBody = useRef<HTMLDivElement | null>(null);
  const { w: workWidth } = STEPS.find(({ key }) => key === Step.Work)?.size ?? { w: 600 };

  /** Нижняя граница последнего блока: ровно такой высоты окно нужно, когда анимации завершены. */
  const bottom = () => Math.ceil(lastRef.current?.getBoundingClientRect().bottom ?? 0);
  const resizeTo = (h: number) => h > 0 && api.shell('resize', { w: workWidth, h });

  /** Какой высоты будет окно, если блоки окажутся в таком состоянии (по естественной высоте их содержимого). */
  const predict = (rules: boolean, queries: boolean) => {
    const delta = (open: boolean, ref: { current: HTMLElement | null }) =>
      ref.current ? (open ? ref.current.scrollHeight : 0) - ref.current.offsetHeight : 0;
    return Math.ceil(bottom() + delta(rules, rulesBody) + delta(queries, queriesBody));
  };

  // Содержимое раскрывается средствами CSS, окно только заранее освобождает или подтягивает место:
  // при раскрытии оно растёт первым, при сворачивании — после того, как блок схлопнулся.
  // Так каждый кадр анимации рисует страница, а не операционная система.
  const timer = useRef<number | null>(null);
  const change = (rules: boolean, queries: boolean) => {
    if (timer.current) window.clearTimeout(timer.current);
    const grow = (rules && !rulesOpen) || (queries && !queriesOpen);
    const target = predict(rules, queries);
    if (grow) {
      resizeTo(target);
      window.requestAnimationFrame(() => {
        setRulesOpen(rules);
        setQueriesOpen(queries);
      });
    } else {
      setRulesOpen(rules);
      setQueriesOpen(queries);
      resizeTo(target > 0 ? target : bottom());
    }
    // когда всё улеглось, подгоняем окно по факту (на случай расхождения с предсказанием)
    timer.current = window.setTimeout(() => resizeTo(bottom()), COLLAPSE_MS + 60);
  };

  // начальный размер рабочего экрана: по факту отрисовки
  useEffect(() => {
    const id = window.requestAnimationFrame(() => resizeTo(bottom()));
    return () => window.cancelAnimationFrame(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const caret = (open: boolean) => (
    <IconChevron
      size={14}
      className={cn('shrink-0 text-brand transition-transform duration-300', open && 'rotate-90')}
    />
  );

  const spoilerButton =
    'flex w-full items-center justify-start gap-2 rounded-pill px-3 py-1.5 text-left text-[15px] font-semibold text-brand hover:bg-hover';

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

      <section className="lg rounded-card px-3 py-2">
        <button
          type="button"
          className={spoilerButton}
          onClick={() => change(!rulesOpen, queriesOpen)}
          aria-expanded={rulesOpen}
        >
          {caret(rulesOpen)}
          Правила подмены
        </button>
        <Collapsible open={rulesOpen} innerRef={rulesBody}>
          <div
            className="overflow-y-auto px-1 pt-2"
            style={{ maxHeight: Math.max(320, window.screen.availHeight - 330) }}
          >
            {rulesSlot}
          </div>
        </Collapsible>
      </section>

      <section ref={lastRef} className="lg -ml-[11px] w-[calc(100%+22px)] rounded-t-card px-4 pt-2 pb-4">
        <button
          type="button"
          className={spoilerButton}
          onClick={() => change(rulesOpen, !queriesOpen)}
          aria-expanded={queriesOpen}
        >
          {caret(queriesOpen)}
          Запросы
          <span className="ml-1 text-xs font-normal text-ink-muted">{rows.length}</span>
        </button>

        <Collapsible open={queriesOpen} innerRef={queriesBody}>
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex items-center gap-2">
              <Input
                type="search"
                placeholder="Поиск по журналу"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1"
              />
              <Segmented
                size="sm"
                ariaLabel="Фильтр журнала"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'mirror', label: 'Подмены' },
                  { value: 'errors', label: 'Ошибки' },
                  { value: 'all', label: 'Все' },
                ]}
              />
              <Button
                size="round"
                variant="secondary"
                className="size-7 shrink-0"
                onClick={onClearLog}
                disabled={log.length === 0}
                title="Очистить журнал"
                aria-label="Очистить журнал"
              >
                <IconClose size={11} />
              </Button>
            </div>

            <div className="lg-soft h-[200px] overflow-auto rounded-lg">
              {rows.length === 0 ? (
                <div className="grid h-full place-items-center text-xs text-ink-muted">Пусто</div>
              ) : (
                <>
                  <div
                    className={cn(
                      ROW,
                      'sticky top-0 z-10 border-b border-glass-line bg-surface-glass py-1.5 backdrop-blur-md',
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
        </Collapsible>
      </section>
    </div>
  );
};
