/**
 * Приветствие при первом запуске. Логотип собран из контуров иконки приложения (lib/logo.ts):
 * плитка проявляется, скобки вырастают из центра, стрелки «печатаются» навстречу друг другу
 * и дальше едва заметно «дышат». Рядом строки текста выезжают из-под маски, а ниже — короткий
 * список возможностей и кнопка «Начать».
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { LOGO, LOGO_VIEWBOX } from '../lib/logo.js';
import { Button } from '../ui/Button.js';

export type SplashScreenProps = {
  version: string;
  onDone: () => void;
};

/** Таймлайн, мс от начала. */
const T = {
  tile: 100,
  braces: 650,
  arrows: 1150,
  name: 1500,
  tagline: 1700,
  features: 1950,
  featureStep: 140,
  footer: 2600,
  button: 2800,
};

const out = 'cubic-bezier(0.16, 1, 0.3, 1)';
const anim = (name: string, delay: number, duration: number, easing = out) => ({
  animation: `${name} ${duration}ms ${easing} ${delay}ms both`,
});

const FEATURES = [
  'Только сайты из ваших масок: остальной трафик не затрагивается',
  'HTTPS под собственным сертификатом, ограниченным вашими доменами',
  'Страница перезагружается сама, когда вы правите файлы',
];

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-0.5 shrink-0 text-brand">
    <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.16" />
    <path
      d="M4.8 8.2l2.2 2.2 4.2-4.6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Строка, которая выезжает из-под маски. */
const Line = ({ delay, children, className }: { delay: number; children: ReactNode; className?: string }) => (
  <div className="overflow-hidden">
    <div className={className} style={anim('bs-rise', delay, 900)}>
      {children}
    </div>
  </div>
);

export const SplashScreen = ({ version, onDone }: SplashScreenProps) => {
  const [leaving, setLeaving] = useState(false);

  const start = useCallback(() => {
    setLeaving((was) => {
      if (!was) window.setTimeout(onDone, 380);
      return true;
    });
  }, [onDone]);

  // Enter и пробел работают как кнопка
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  /** Стрелка: «печатается» (wipe), затем бесконечно едва заметно смещается (flow). */
  const arrow = (delay: number, wipe: string, flow: string) => ({
    animation: `${wipe} 800ms cubic-bezier(0.65, 0, 0.35, 1) ${delay}ms both, ${flow} 2800ms ease-in-out ${delay + 900}ms infinite alternate`,
  });
  const brace = (delay: number) => ({
    ...anim('bs-grow-y', delay, 800),
    transformBox: 'fill-box' as const,
    transformOrigin: 'center',
  });

  return (
    <div
      className="grid h-full place-items-center"
      style={{
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(-10px) scale(0.99)' : 'none',
        transition: 'opacity 360ms ease, transform 380ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <div className="flex w-full max-w-[540px] flex-col gap-7">
        <div className="flex items-center gap-8">
          {/* плитка как у иконки приложения */}
          <div
            className="relative grid size-[176px] shrink-0 place-items-center rounded-[44px] bg-white"
            style={{
              boxShadow:
                '0 18px 44px rgb(0 0 0 / 26%), 0 3px 10px rgb(0 0 0 / 16%), inset 0 1px 0 rgb(255 255 255), inset 0 -2px 6px rgb(15 23 42 / 8%)',
              ...anim('bs-pop', T.tile, 900),
            }}
          >
            <svg viewBox={LOGO_VIEWBOX} className="size-full" role="img" aria-label="BodySnatch">
              <path d={LOGO.braceLeft} fill={LOGO.colors.brace} style={brace(T.braces)} />
              <path d={LOGO.braceRight} fill={LOGO.colors.brace} style={brace(T.braces + 90)} />
              <path d={LOGO.blueArrow} fill={LOGO.colors.blue} style={arrow(T.arrows, 'bs-wipe-r', 'bs-flow-r')} />
              <path
                d={LOGO.greenArrow}
                fill={LOGO.colors.green}
                style={arrow(T.arrows + 200, 'bs-wipe-l', 'bs-flow-l')}
              />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <Line delay={T.name} className="text-[40px] leading-[1.1] font-semibold tracking-tight text-ink">
              BodySnatch
            </Line>
            <Line delay={T.tagline} className="mt-1 text-[15px] text-ink-soft">
              Подмена файлов сайта на лету
            </Line>
            <ul className="mt-5 flex flex-col gap-2.5">
              {FEATURES.map((text, i) => (
                <li
                  key={text}
                  className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-soft"
                  style={anim('bs-slide-in', T.features + i * T.featureStep, 700)}
                >
                  <Check />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-1">
          <div className="text-xs text-ink-muted" style={anim('bs-fade-in', T.footer, 700)}>
            v {version} · author: M. Khamitov
          </div>
          <div style={anim('bs-fade-in', T.button, 700)}>
            <Button
              variant="primary"
              onClick={start}
              autoFocus
              className="px-6"
              style={{ animation: `bs-btn-glow 2.4s ease-in-out ${T.button + 900}ms infinite` }}
            >
              Начать
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M2.5 7h9M8 3.2L11.8 7 8 10.8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
