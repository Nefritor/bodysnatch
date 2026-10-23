/**
 * Оркестратор мастера BodySnatch Desktop:
 * прокси → сертификат → правила → работа (свитч выключен, пока его не включат).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, useState1s } from './api.js';
import type { MaskOption, SiteMask } from './types.js';
import { TitleBar } from './components/index.js';
import { CertScreen, ProxyScreen, RulesScreen, RunningScreen } from './screens/index.js';

interface IStepsData {
  key: Step;
  label: string;
  size: {
    w: number;
    h: number;
  }
}

enum Step {
  Cert = 'cert',
  Proxy = 'proxy',
  Rules = 'rules',
  Work = 'work',
};

const STEPS: IStepsData[] = [
  { key: Step.Cert, label: 'Сертификат', size: { w: 600, h: 350 } },
  { key: Step.Proxy, label: 'Прокси', size: { w: 600, h: 300 } },
  { key: Step.Rules, label: 'Правила', size: { w: 600, h: 630 } },
  { key: Step.Work, label: 'Работа', size: { w: 600, h: 150 } },
];

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
  const forcedPause = useRef(false);
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

  if (error && !state) {
    return (
      <div className="app">
        {native && <TitleBar running={false} />}
        <main className={step === 'work' ? 'stage stage-work' : 'stage'}>
          <div className="card center" ref={contentRef}>
            <h1>Нет связи с прокси</h1>
            <p className="muted">{error}</p>
            <p className="hint">Похоже, приложение ещё не запущено. Запустите BodySnatch Desktop и обновите страницу.</p>
          </div>
        </main>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="app">
        {native && <TitleBar running={false} />}
        <main className={step === 'work' ? 'stage stage-work' : 'stage'}>
          <div className="card center" ref={contentRef}>
            <h1>Загружаем настройки…</h1>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      {native && <TitleBar running={state.enabled} />}
      <main className={step === Step.Work ? 'stage stage-work' : 'stage'}>
        <div
          ref={contentRef}
          className="wrapper"
        >
          {step !== Step.Work && (
            <div className="path">
              {STEPS.map((s, i) => {
                const reachable = i <= activeIdx && (i === 0 || state.systemProxy.ours);
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`badge step-btn ${i === activeIdx ? 'ok-text' : 'muted'}`}
                    style={{ opacity: i === activeIdx ? 1 : 0.75 }}
                    disabled={!reachable || i === activeIdx}
                    title={i < activeIdx && reachable ? 'Вернуться на шаг' : undefined}
                    onClick={() => reachable && setStep(s.key)}
                  >
                    {i + 1}. {s.label}
                  </button>
                );
              })}
            </div>
          )}

          {step === Step.Cert && (
            <CertScreen snap={state} busy={busy} onNext={() => setStep(Step.Proxy)} />
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
              busy={busy}
              onToggle={
                (on) =>
                  run(
                    () =>
                      Promise.all(
                        [
                          api.setEnabled(on),
                          on
                            ? api.proxyOn()
                            : api.proxyOff()
                        ]
                      )
                  )
              }
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
      </main>
    </div>
  );
}
