/**
 * Приветствие при первом запуске: фигурные скобки влетают с боков, стрелки — из углов,
 * после этого проявляются название, версия и автор. Потом экран плавно уходит.
 */
import { useEffect, useState } from 'react';

export type SplashScreenProps = {
  version: string;
  onDone: () => void;
};

/** Таймлайн в миллисекундах от начала. */
const T = {
  braces: 0,
  arrows: 700,
  title: 1700,
  version: 2150,
  author: 2600,
  hold: 3900,
  leave: 4400,
};

const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
const anim = (name: string, delay: number, duration: number) => ({
  animation: `${name} ${duration}ms ${ease} ${delay}ms both`,
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
    window.setTimeout(onDone, 250);
  };

  return (
    <div
      className="grid h-full cursor-pointer place-items-center transition-opacity duration-500"
      style={{ opacity: leaving ? 0 : 1 }}
      onClick={skip}
      role="presentation"
    >
      <div className="flex flex-col items-center">
        <svg viewBox="0 0 360 230" className="w-[330px] overflow-visible" role="img" aria-label="BodySnatch">
          <g fill="currentColor" className="text-ink" style={{ fontFamily: 'var(--font-ui)' }}>
            <text
              x="92"
              y="118"
              fontSize="230"
              fontWeight="500"
              textAnchor="middle"
              dominantBaseline="central"
              style={anim('bs-brace-left', T.braces, 900)}
            >
              {'{'}
            </text>
            <text
              x="268"
              y="118"
              fontSize="230"
              fontWeight="500"
              textAnchor="middle"
              dominantBaseline="central"
              style={anim('bs-brace-right', T.braces, 900)}
            >
              {'}'}
            </text>
          </g>
          <g
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={anim('bs-arrow-blue', T.arrows, 1000)}
          >
            <path d="M136 92 H224 M208 76 L226 92 L208 108" stroke="#2f7be5" />
          </g>
          <g
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={anim('bs-arrow-green', T.arrows + 120, 1000)}
          >
            <path d="M224 146 H136 M152 130 L134 146 L152 162" stroke="#2fa84f" />
          </g>
        </svg>

        <h1
          className="mt-1 text-[40px] leading-none font-semibold tracking-tight text-ink"
          style={anim('bs-fade-in', T.title, 700)}
        >
          BodySnatch
        </h1>
        <div className="mt-3 text-sm text-ink-soft" style={anim('bs-fade-in', T.version, 700)}>
          v {version}
        </div>
        <div className="mt-1 text-xs text-ink-muted" style={anim('bs-fade-in', T.author, 700)}>
          author: M. Khamitov
        </div>
      </div>
    </div>
  );
};
