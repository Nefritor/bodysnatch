/**
 * Набор мелких иконок интерфейса: инлайн-SVG, наследуют цвет текста.
 * Вместо текстовых символов («+», «×», «…») — чтобы вид не зависел от шрифта
 * и толщина линий везде была одинаковой.
 */
export type IconProps = {
  /** Название класса */
  className?: string;
  /** сторона квадрата в пикселях, по умолчанию 16 */
  size?: number;
  /** толщина линии */
  strokeWidth?: number;
};

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'aria-hidden': true,
  focusable: false,
});

export const IconPlus = ({ className, size = 16, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconClose = ({ className, size = 16, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconMore = ({ className, size = 16 }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

export const IconCheck = ({ className, size = 16, strokeWidth = 2.4 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const IconChevron = ({ className, size = 16, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconChevronDown = ({ className, size = 16, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** Печать с ленточками: сертификат как документ, а не абстрактный щит. */
export const IconSeal = ({ className, size = 16, strokeWidth = 1.6 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="9" r="5.6" />
    <path d="M8.8 13.6 7.6 21l4.4-2.3L16.4 21l-1.2-7.4" />
    <path d="M10.4 9l1.2 1.2L14 7.8" />
  </svg>
);

/** Та же печать, но с галочкой: сертификат установлен и доверен. */
export const IconSealCheck = ({ className, size = 16, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="9" r="5.6" />
    <path d="M8.8 13.6 7.6 21l4.4-2.3L16.4 21l-1.2-7.4" />
    <path d="M9.8 9.1l1.5 1.5 2.9-3" />
  </svg>
);

/** Предупреждение: треугольник с восклицательным знаком. */
export const IconWarning = ({ className, size = 16, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.6 21 19.4H3L12 3.6Z" />
    <path d="M12 9.4v4.2" />
    <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/** Карандаш: перевыбрать путь к папке. */
export const IconPencil = ({ className, size = 16, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L4 16v4Z" />
    <path d="M14.6 5.4l4 4" />
  </svg>
);

export const IconGear = ({ className, size = 16, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
