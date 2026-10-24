/**
 * Оркестратор мастера BodySnatch Desktop:
 * сертификат → прокси → правила → работа (свитч выключен, пока его не включат).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useBodysnatch } from './api.js';
import type { MaskOption, SiteMask } from './types.js';
import { TitleBar } from './components/index.js';
import { CertScreen, ProxyScreen, RulesScreen, RunningScreen, SplashScreen } from './screens/index.js';
import { STEPS, Step } from './constants.js';
import { cn } from './ui/cn.js';
import { startStep } from './lib/startStep.js';

const WELCOMED_KEY = 'bodysnatch.welcomed';

export function App() {
  const { state, error, refresh, log, clearLog } = useBodysnatch();
  // Шаг выбирается по первому снимку состояния (см. startStep); до этого — null.
  // ?screen=… — отладочный переход сразу на нужный экран.
  const [chosen, setStep] = useState<Step | null>(() => {
    try {
      const screen = new URLSearchParams(window.location.search).get('screen');
      const known = [Step.Cert, Step.Proxy, Step.Rules, Step.Work] as string[];
      return screen && known.includes(screen) ? (screen as Step) : null;
    } catch {
      return null;
    }
  });
  const step = chosen ?? Step.Cert;
  // Приветствие показывается один раз, при первом запуске (?splash=1 — показать снова)
  const [splash, setSplash] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('splash') === '1') return true;
      if (params.get('screen')) return false;
      return localStorage.getItem(WELCOMED_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const finishSplash = useCallback(() => {
    try {
      localStorage.setItem(WELCOMED_KEY, '1');
    } catch {
      /* приватный режим: приветствие просто покажется снова */
    }
    setSplash(false);
  }, []);
  const [busy, setBusy] = useState(false);
  const [mask, setMask] = useState<SiteMask | null>(null);
  const [files, setFiles] = useState<MaskOption[] | null>(null);
  const [message, setMessage] = useState('');
  const initialized = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stepBodyRef = useRef<HTMLDivElement | null>(null);
  const native = api.hasNativeShell();

  // Сообщаем окну, что мастер пройден: только на рабочем экране «закрыть» уходит
  // в трей, на этапах настройки приложение закрывается полностью.
  useEffect(() => {
    if (!native || chosen === null) return;
    if (splash) {
      api.shell('resize', { w: 600, h: 400 });
      return;
    }
    const stepData = STEPS.find(({ key }) => key === step);
    if (stepData) {
      api.shell('step', { step });
      api.shell('resize', { w: stepData.size.w, h: stepData.size.h });
    }
  }, [native, step, chosen, splash]);

  // Окно шага подгоняется под содержимое: высота из constants.ts — минимум, а если содержимое стало
  // выше (блок с ошибкой, предупреждение, длинное сообщение), окно вырастает, чтобы ничего не обрезалось,
  // и возвращается к минимуму, когда лишнее исчезло.
  useEffect(() => {
    if (!native || splash || step === Step.Work || !state) return undefined;
    const body = stepBodyRef.current;
    const base = STEPS.find(({ key }) => key === step)?.size;
    if (!body || !base) return undefined;
    let frame = 0;
    let sent = 0;
    const fit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const screen = body.firstElementChild as HTMLElement | null;
        if (!screen) return;
        const gap = Number.parseFloat(getComputedStyle(screen).rowGap) || 0;
        const kids = [...screen.children] as HTMLElement[];
        const natural = kids.reduce((sum, k) => sum + k.offsetHeight, 0) + gap * Math.max(0, kids.length - 1);
        // сколько не хватает (или остаётся лишним) относительно текущей высоты окна
        const wanted = Math.max(base.h, Math.ceil(window.innerHeight + natural - screen.offsetHeight));
        if (Math.abs(wanted - sent) > 1) {
          sent = wanted;
          api.shell('resize', { w: base.w, h: wanted });
        }
      });
    };
    const resizeObserver = new ResizeObserver(fit);
    const observeKids = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(body);
      for (const kid of (body.firstElementChild?.children ?? []) as Iterable<Element>) resizeObserver.observe(kid);
    };
    observeKids();
    // новые блоки внутри экрана (например, ошибка установки сертификата) появляются как новые элементы
    const mutationObserver = new MutationObserver(() => {
      observeKids();
      fit();
    });
    mutationObserver.observe(body, { childList: true, subtree: true });
    fit();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [native, splash, step, state]);

  // Окно показывается только когда отрисован первый осмысленный кадр
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || (!state && !error)) return;
    revealed.current = true;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => api.shell('ready')));
  }, [state, error]);

  /** Последняя ошибка включения прокси — показывается в подсказке бейджа. */
  const enableProxy = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await api.proxyOn();
      if (res && res.ok === false) {
        setMessage(res.error || 'не удалось включить прокси');
      }
      await refresh();
    } catch (e) {
      setMessage(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // первый снимок: подтягиваем маску и файлы из конфига
  useEffect(() => {
    if (!state || initialized.current) return;
    initialized.current = true;
    setStep((current) => current ?? startStep(state));
    setMask(state.mask);
    setFiles(state.files);
  }, [state]);

  /** сохранить маску/файлы в конфиг прокси */
  const persist = useCallback(
    async (nextMask: SiteMask | null, nextFiles: MaskOption[] | null) => {
      if (!state) return;
      const sites = (state.sites || []).map((s, i) =>
        i === 0 ? { ...s, mask: nextMask ?? s.mask, files: nextFiles ?? s.files } : s,
      );
      try {
        await api.saveConfig({ sites, roots: state.roots.map((r) => r.path), moduleRoots: state.moduleRoots });
      } catch {
        /* следующий опрос покажет актуальное */
      }
    },
    [state],
  );

  const run = useCallback(
    async (fn: () => Promise<unknown>, okText?: string) => {
      setBusy(true);
      setMessage('');
      try {
        const res = (await fn()) as { ok?: boolean; error?: string; message?: string } | undefined;
        if (res && res.ok === false) setMessage(res.error || res.message || 'не получилось');
        else if (okText) setMessage(okText);
        await refresh();
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        setMessage(msg.includes('abort') ? 'прокси не ответил вовремя — попробуйте ещё раз' : msg);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const activeIdx = STEPS.findIndex((s) => s.key === step);
  const shell = 'mx-auto w-full max-w-[900px]';

  const frame = (children: React.ReactNode) => (
    <div className="flex h-screen flex-col overflow-hidden">
      {native && <TitleBar running={Boolean(state?.enabled)} version={state?.version} />}
      <main className={cn('min-h-0 flex-1 pl-2 pr-2', step !== Step.Work && 'pb-2')}>
        <div className={cn('h-full', shell)}>{children}</div>
      </main>
    </div>
  );

  if (error && !state) {
    return frame(
      <div className="grid h-full place-items-center lg rounded-card p-6 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold text-ink">Нет связи с прокси</h1>
          <p className="text-sm text-ink-muted">{error}</p>
          <p className="text-xs text-ink-subtle">
            Похоже, приложение ещё не запущено. Запустите BodySnatch Desktop и обновите страницу.
          </p>
        </div>
      </div>,
    );
  }

  if (!state) {
    // перед заставкой не показываем «Загружаем…»: окно ещё скрыто и появится сразу с приветствием
    if (splash) return frame(<div />);
    return frame(
      <div className="grid h-full place-items-center lg rounded-card p-6 text-center">
        <h1 className="text-xl font-semibold text-ink">Загружаем настройки…</h1>
      </div>,
    );
  }

  if (splash) return frame(<SplashScreen version={state.version} onDone={finishSplash} />);

  return frame(
    <div
      ref={contentRef}
      className={cn(
        'flex h-full animate-[bs-screen-in_0.7s_cubic-bezier(0.22,1,0.36,1)_both] flex-col gap-3',
        step !== Step.Work && 'lg rounded-card p-6',
      )}
    >
      {step !== Step.Work && (
        <div className="flex flex-wrap items-center gap-1.5">
          {STEPS.filter(({ key }) => key !== Step.Work).map((s, i) => {
            const reachable = i <= activeIdx && (i === 0 || state.systemProxy.ours);
            return (
              <button
                key={s.key}
                type="button"
                disabled={!reachable || i === activeIdx}
                title={i < activeIdx && reachable ? 'Вернуться на шаг' : undefined}
                onClick={() => reachable && setStep(s.key)}
                className={cn(
                  'rounded-pill border px-2.5 py-0.5 text-xs backdrop-blur-md transition-colors',
                  i === activeIdx
                    ? 'border-brand/40 bg-brand-soft font-semibold text-brand'
                    : 'border-glass-line bg-field text-ink-muted hover:bg-glass-strong',
                  i !== activeIdx && !reachable && 'cursor-default opacity-60',
                )}
              >
                {i + 1}. {s.label}
              </button>
            );
          })}
          {state.cert.trusted && state.cert.constraints.uncovered.length === 0 ? (
            <button
              type="button"
              onClick={() => setStep(Step.Work)}
              className="ml-auto rounded-pill px-2.5 py-0.5 text-xs font-medium text-brand hover:text-brand-deep"
            >
              К работе →
            </button>
          ) : null}
        </div>
      )}

      <div ref={stepBodyRef} className="min-h-0 flex-1">
        {step === Step.Cert && (
          <CertScreen snap={state} busy={busy} onNext={() => setStep(Step.Proxy)} onRefresh={() => void refresh()} />
        )}

        {step === Step.Proxy && (
          <ProxyScreen
            snap={state}
            busy={busy}
            notice={message}
            onEnable={() => void enableProxy()}
            onDisable={() => run(() => api.proxyOff(), '')}
            onNext={() => setStep(Step.Rules)}
          />
        )}

        {step === Step.Rules && (
          <RulesScreen
            snap={state}
            mask={mask ?? state.mask}
            files={files ?? state.files}
            onChanged={() => void refresh()}
            onMaskChange={(next) => {
              setMask(next);
              void persist(next, files);
            }}
            onFilesChange={(next) => {
              setFiles(next);
              void persist(mask, next);
            }}
            onDone={() => setStep(Step.Work)}
          />
        )}

        {step === Step.Work && (
          <RunningScreen
            snap={state}
            log={log}
            onClearLog={() => void clearLog()}
            busy={busy}
            onToggle={(on) => run(() => Promise.all([api.setEnabled(on), on ? api.proxyOn() : api.proxyOff()]))}
            onSettings={() => setStep(Step.Cert)}
            rulesSlot={
              <RulesScreen
                snap={state}
                mask={mask ?? state.mask}
                files={files ?? state.files}
                onChanged={() => void refresh()}
                onMaskChange={(next) => {
                  setMask(next);
                  void persist(next, files);
                }}
                onFilesChange={(next) => {
                  setFiles(next);
                  void persist(mask, next);
                }}
                onDone={() => setStep(Step.Work)}
                embedded
              />
            }
          />
        )}
      </div>
    </div>,
  );
}
