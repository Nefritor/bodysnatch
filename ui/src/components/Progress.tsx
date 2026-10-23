/** Полоса прогресса скана браузеров. */
export type ProgressProps = {
  /** 0…100 */
  value: number;
};

export const Progress = ({ value }: ProgressProps) => (
  <div
    className="h-1.5 w-full overflow-hidden rounded-pill bg-ink/10"
    role="progressbar"
    aria-valuenow={Math.round(value)}
  >
    <div
      className="h-full rounded-pill bg-brand transition-[width] duration-200"
      style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
    />
  </div>
);
