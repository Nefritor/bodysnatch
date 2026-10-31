/**
 * Кэш проверок файловой системы и наблюдатель за папками с кодом.
 *
 * Каждый запрос браузера раньше стоил нескольких existsSync/statSync. Теперь
 * результат живёт до первого изменения в папке (fs.watch) или до истечения TTL.
 */
import fs from 'node:fs';

export class FileCache {
  constructor({ ttl = 3000, onChange = () => {} } = {}) {
    this.ttl = ttl;
    this.onChange = onChange;
    this.files = new Map();
    this.watchers = new Map();
    this.timer = null;
    this.pending = new Set();
  }

  #lookup(p) {
    const now = Date.now();
    const hit = this.files.get(p);
    if (hit && now - hit.at < this.ttl) return hit;
    let kind = 'none';
    try {
      kind = fs.statSync(p).isFile() ? 'file' : 'dir';
    } catch {
      /* нет такого пути */
    }
    const entry = { kind, at: now };
    if (this.files.size > 20000) this.files.clear();
    this.files.set(p, entry);
    return entry;
  }

  isFile(p) {
    return this.#lookup(p).kind === 'file';
  }

  exists(p) {
    return this.#lookup(p).kind !== 'none';
  }

  clear() {
    this.files.clear();
  }

  /** Следить за этими папками; повторный вызов заменяет набор. */
  watch(roots) {
    const wanted = new Set(roots.filter(Boolean));
    for (const [root, w] of this.watchers) {
      if (wanted.has(root)) continue;
      w.close();
      this.watchers.delete(root);
    }
    for (const root of wanted) {
      if (this.watchers.has(root)) continue;
      try {
        const w = fs.watch(root, { recursive: true }, (_event, name) => this.#changed(root, name));
        w.on('error', () => {
          w.close();
          this.watchers.delete(root);
        });
        this.watchers.set(root, w);
      } catch {
        /* папки нет или наблюдение недоступно: остаётся TTL */
      }
    }
  }

  #changed(root, name) {
    this.files.clear();
    this.pending.add(String(name || ''));
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const files = [...this.pending];
      this.pending.clear();
      this.onChange(files);
    }, 120);
  }

  close() {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}
