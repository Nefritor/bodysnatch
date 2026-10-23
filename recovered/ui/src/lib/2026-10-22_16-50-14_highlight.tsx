/** Подсветка совпадений поиска: оборачивает найденное в <mark>. */
import type { ReactElement } from 'react';

export const highlight = (text: string, query: string) => {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: Array<string | ReactElement> = [];
  let from = 0;
  let at = lower.indexOf(needle);
  let n = 0;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={`h${n}`} className="rounded-sm bg-amber-300/60 px-0.5 text-sm text-ink outline-1 outline-amber-500/45">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    n += 1;
    from = at + q.length;
    at = lower.indexOf(needle, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
};
