/**
 * Оркестратор мастера BodySnatch Desktop:
 * сертификат → прокси → правила → работа (свитч выключен, пока его не включат).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useState1s } from './api.js';
import type { MaskOption, SiteMask } from './types.js';
import { TitleBar } from './components/index.js';
import { CertScreen, ProxyScreen, RulesScreen, RunningScreen } from './screens/index.js';
import { STEPS, Step } from './constants.js';
import { cn } from './ui/cn.js';

export function App() {
  const { state, error, refresh } = useState1s(1200);
  const [step, setStep] = useState<Step>(() => {
    try {
      return new URLSearchParams(window.location.search).get('screen') === Step.Work ? Step.Work : Step.Cert;
    } catch {
      return Step.Cert;
    }
  });
  const [busy, setBusy] = useState(false);
  const [mask, setMask] = useState<SiteMask | null>(null);
  const [files, setFiles] = useState<MaskOption[] | null>(null);
  const [message, setMessage] = useState('');
  const initialized = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const native = api.hasNativeShell();

  // Сообщаем окну, что мастер пройден: только на рабочем экране «закрыть» уходит
  // в трей, на этапах настройки приложение закрывается полностью.
  useEffect(() => {
    if (!native) return;
    const stepData = STEPS.find(({ key }) => key === step);
    if (stepData) {
      api.shell('step', { step });
      api.shell('resize', { w: stepData.size.w, h: stepData.size.h });
    }
  }, [native, step]);

  /** Последняя ошибка включения прокси — показывается в подсказке бейджа. */
  const enableProxy = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await api.proxyOn();
      if (res && res.ok === false) {
        setMessage(res.cancelled ? 'запрос прав отменён' : res.error || 'не удалось включить прокси');
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
      {native && <TitleBar running={Boolean(state?.enabled)} />}
      <main className="min-h-0 flex-1 pl-2 pb-2 pr-2">
        <div className={cn('h-full', shell)}>{children}</div>
      </main>
    </div>
  );

  if (error && !state) {
    return frame(
      <div className="grid h-full place-items-center rounded-window border border-glass-line bg-glass p-6 text-center shadow-glass backdrop-blur-xl">
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
    return frame(
      <div className="grid h-full place-items-center rounded-window border border-glass-line bg-glass p-6 text-center shadow-glass backdrop-blur-xl">
        <h1 className="text-xl font-semibold text-ink">Загружаем настройки…</h1>
      </div>,
    );
  }

  return frame(
    <div
      ref={contentRef}
      className={cn(
        'flex h-full flex-col gap-3',
        step !== Step.Work &&
        'rounded-window border border-glass-line bg-glass p-6 shadow-glass backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]',
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
                    ? 'border-brand/25 bg-brand-soft font-semibold text-brand'
                    : 'border-glass-line bg-field text-ink-muted hover:bg-glass-strong',
                  !reachable && 'cursor-default opacity-60',
                )}
              >
                {i + 1}. {s.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {step === Step.Cert && <CertScreen snap={state} busy={busy} onNext={() => setStep(Step.Proxy)} />}

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
            busy={busy}
            onToggle={(on) => run(() => Promise.all([api.setEnabled(on), on ? api.proxyOn() : api.proxyOff()]))}
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
