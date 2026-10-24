/**
 * Приветствие при первом запуске. Логотип собирается из тех же контуров, что и иконка
 * приложения (см. lib/logo.ts): скобки влетают с боков, стрелки — из углов, затем по логотипу
 * проходит блик, проявляются название, версия и автор, и экран мягко уходит.
 */
import { useEffect, useState } from 'react';
import { LOGO, LOGO_VIEWBOX } from '../lib/logo.js';

export type SplashScreenProps = {
  version: string;
  onDone: () => void;
};

/** Таймлайн, мс от начала. */
const T = {
  braces: 150,
  arrows: 950,
  sheen: 2000,
  title: 2250,
  version: 3000,
  author: 3350,
  hold: 4700,
  leave: 5300,
};

const out = 'cubic-bezier(0.16, 1, 0.3, 1)';

const anim = (name: string, delay: number, duration: number, easing = out) => ({
  animation: `${name} ${duration}ms ${easing} ${delay}ms both`,
});

export const SplashScreen = ({ version, onDone }: SplashScreenProps) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const toLeave = window.setTimeout(() => setLeaving(true), T.hold);
    const toDone = window.setTimeout(onDone, T.leave);
    return () => {
      window.clearTimeout(toLeave);
      window.clearTimeout(toDone);
    };
  }, [onDone]);

  const skip = () => {
    setLeaving(true);
    window.setTimeout(onDone, 350);
  };

  return (
    <div
      className="relative grid h-full cursor-pointer place-items-center"
      style={{
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'scale(1.045)' : 'none',
        transition: 'opacity 520ms ease, transform 620ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onClick={skip}
      role="presentation"
    >
      {/* мягкое свечение за логотипом: вспыхивает, когда стрелки встали на место */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[44%] left-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: 'radial-gradient(closest-side, rgb(66 133 244 / 28%), rgb(52 168 83 / 12%) 55%, transparent 75%)',
          ...anim('bs-glow', T.arrows + 650, 1900),
        }}
      />

      <div className="relative flex flex-col items-center">
        {/* плитка как у иконки приложения: логотип читается и на тёмной, и на светлой теме */}
        <div
          className="relative grid size-[236px] place-items-center rounded-[58px] bg-white"
          style={{
            boxShadow:
              '0 18px 44px rgb(0 0 0 / 26%), 0 3px 10px rgb(0 0 0 / 16%), inset 0 1px 0 rgb(255 255 255), inset 0 -2px 6px rgb(15 23 42 / 8%)',
            ...anim('bs-tile', 0, 900),
          }}
        >
          <svg viewBox={LOGO_VIEWBOX} className="size-full overflow-visible" role="img" aria-label="BodySnatch">
            <defs>
              <clipPath id="bs-logo-clip">
                <path d={LOGO.braceLeft} />
                <path d={LOGO.braceRight} />
                <path d={LOGO.blueArrow} />
                <path d={LOGO.greenArrow} />
              </clipPath>
              <linearGradient id="bs-sheen" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>

            <g style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
              <path
                d={LOGO.braceLeft}
                fill={LOGO.colors.brace}
                style={{
                  ...anim('bs-brace-left', T.braces, 1100),
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                }}
              />
              <path
                d={LOGO.braceRight}
                fill={LOGO.colors.brace}
                style={{
                  ...anim('bs-brace-right', T.braces + 70, 1100),
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                }}
              />
              <path
                d={LOGO.blueArrow}
                fill={LOGO.colors.blue}
                style={{
                  ...anim('bs-arrow-blue', T.arrows, 1250),
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                }}
              />
              <path
                d={LOGO.greenArrow}
                fill={LOGO.colors.green}
                style={{
                  ...anim('bs-arrow-green', T.arrows + 160, 1250),
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                }}
              />
            </g>

            {/* блик, скользящий по собранному логотипу */}
            <g clipPath="url(#bs-logo-clip)">
              <rect
                x="-300"
                y="-100"
                width="260"
                height="1250"
                fill="url(#bs-sheen)"
                transform="skewX(-18)"
                style={anim('bs-sheen', T.sheen, 1300, 'cubic-bezier(0.45, 0, 0.2, 1)')}
              />
            </g>
          </svg>
        </div>

        <h1 className="mt-7 text-[44px] leading-none font-semibold text-ink" style={anim('bs-title', T.title, 1100)}>
          BodySnatch
        </h1>

        <div
          className="mt-3 text-[13px] tracking-[0.18em] text-ink-soft uppercase"
          style={anim('bs-fade-in', T.version, 800)}
        >
          v {version}
        </div>
        <div className="mt-1.5 text-xs tracking-wide text-ink-muted" style={anim('bs-fade-in', T.author, 800)}>
          author: M. Khamitov
        </div>
      </div>
    </div>
  );
};
