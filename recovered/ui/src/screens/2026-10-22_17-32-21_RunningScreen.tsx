/** Рабочий экран: свитч рядом с названием, правила и запросы — под спойлерами. */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { api } from '../api.js';
import type { LogEntry, Snapshot } from '../types.js';
import { Switch } from '../components/index.js';
import { IconChevron } from '../components/icons.js';
import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';
import { cn } from '../ui/cn.js';
import { Step, STEPS } from '../constants.js';
import { highlight } from '../lib/highlight.js';

export type RunningScreenProps = {
  snap: Snapshot;
  busy: boolean;
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

/**
 * Журнал живёт в модуле, а не только в состоянии компонента: при перемонтировании
 * экрана (или перерисовке дерева) строки больше не «исчезают сами по себе».
 */
let logCache: LogEntry[] = [];
const logKey = (e: LogEntry) => `${e.t}|${e.status}|${e.file || ''}|${e.url}`;

/** Строка таблицы: фиксированные первые три колонки, последняя — по остатку. */
const ROW = 'grid grid-cols-[74px_72px_160px_minmax(0,1fr)] items-center gap-2 px-1';

export const RunningScreen = ({ snap, busy, onToggle, rulesSlot }: RunningScreenProps) => {
  const [log, setLog] = useState<LogEntry[]>(logCache);
  const [query, setQuery] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [queriesOpen, setQueriesOpen] = useState(false);
  // свитч отзывается мгновенно, не дожидаясь опроса состояния
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (pending !== null && snap.enabled === pending) setPending(null);
  }, [snap.enabled, pending]);
  const checked = pending ?? snap.enabled;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.log(300);
        if (!alive || !r || !Array.isArray(r.log)) return;
        // Дополняем, а не заменяем: журнал не должен «пропадать» ни при
        // перезапуске прокси, ни при перемонтировании экрана.
        const seen = new Set(r.log.map(logKey));
        const merged = [...r.log, ...logCache.filter((e) => !seen.has(logKey(e)))].slice(0, 500);
        logCache = merged;
        setLog(merged);
      } catch {
        /* прокси мог закрыться */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const clearLog = async () => {
    logCache = [];
    setLog([]);
    try {
      await api.clearLog();
    } catch {
      /* прокси мог не ответить */
    }
  };

  // только подмены локальными файлами, последние 100, с поиском по содержимому
  const rows = useMemo(() => {
    const mirrored = log.filter((e) => e.via.startsWith('mirror') && e.file);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? mirrored.filter((e) =>
        `${e.t} ${e.status} ${e.module || ''} ${e.file || ''} ${tailAfterModule(e.file || '', e.module || '')} ${e.url}`
          .toLowerCase()
          .includes(q),
      )
      : mirrored;
    return filtered.slice(0, 100);
  }, [log, query]);

  useEffect(() => {
    const sizes = STEPS.find(({ key }) => key === Step.Work)?.size;
    if (sizes) {
      const h = sizes.h + (rulesOpen ? 460 : 0) + (queriesOpen ? 250 : 0);
      api.shell('resize', { w: sizes.w, h });
    }
  }, [rulesOpen, queriesOpen]);

  const caret = (open: boolean) => (
    <IconChevron size={14} className={cn('shrink-0 text-brand transition-transform', open && 'rotate-90')} />
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-col gap-1.5">
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
          прокси {snap.systemProxy.ours ? 'включён' : 'не включён'} · порт {snap.port} · модулей{' '}
          {Object.keys(snap.moduleRoots || {}).length} · локальных ответов {snap.stats.local}
        </div>
      </div>

      <section className="rounded-window border border-glass-line bg-glass px-4 py-2 shadow-glass backdrop-blur-xl backdrop-saturate-150">
        <button
          type="button"
          className="flex w-full items-center justify-start gap-2 rounded-sm px-1 py-1.5 text-left text-[15px] font-semibold text-brand transition-colors hover:bg-field"
          onClick={() => setRulesOpen((v) => !v)}
          aria-expanded={rulesOpen}
        >
          {caret(rulesOpen)}
          Правила подмены
        </button>
        {rulesOpen ? (
          <div className="h-[475px] overflow-hidden pt-2">
            <div className="h-full overflow-auto pr-1">{rulesSlot}</div>
          </div>
        ) : null}
      </section>

      <section
        className={cn(
          'rounded-t-window border border-b-0 border-glass-line bg-glass shadow-glass backdrop-blur-(--glass-blur) backdrop-saturate-(--glass-saturate)',
          'mt-auto px-4 py-2',
        )}
      >
        <button
          type="button"
          className="flex w-full items-center justify-start gap-2 rounded-sm px-1 py-1.5 text-left text-[15px] font-semibold text-brand transition-colors hover:bg-field"
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
              <Button size="sm" onClick={() => void clearLog()} title="Очистить журнал">
                Очистить
              </Button>
            </div>

            {rows.length === 0 ? (
              <div className="grid h-[200px] place-items-center rounded-md border border-glass-line bg-glass text-xs text-ink-muted backdrop-blur-[var(--glass-blur)]">
                Пусто
              </div>
            ) : (
              <div className="h-[200px] overflow-auto rounded-md border border-glass-line bg-glass px-3 backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]">
                <div
                  className={cn(
                    ROW,
                    'sticky top-0 z-10 bg-glass-strong py-1.5 text-xs font-semibold text-ink-muted backdrop-blur-md',
                  )}
                >
                  <span>Время</span>
                  <span>Статус</span>
                  <span>Модуль</span>
                  <span>Локальный файл</span>
                </div>
                {rows.map((e, i) => (
                  <div
                    key={`${e.t}-${e.file}-${i}`}
                    className={cn(
                      ROW,
                      'border-b border-line py-1 text-xs transition-colors last:border-0 hover:bg-hover',
                    )}
                  >
                    <span className="truncate text-ink-muted">{highlight(String(e.t).slice(0, 8), query)}</span>
                    <span>
                      <Badge tone={e.status >= 200 && e.status < 400 ? 'ok' : 'bad'}>
                        {highlight(String(e.status), query)}
                      </Badge>
                    </span>
                    <span className="truncate">
                      <Badge title={e.module || ''}>{highlight(e.module || '—', query)}</Badge>
                    </span>
                    <span className="truncate font-mono text-ink" title={e.file || ''}>
                      {highlight(tailAfterModule(e.file || '', e.module || ''), query)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
};
