/** Скан папок: руты, модули, маска — то, что показывает интерфейс. */
import fs from 'node:fs';
import path from 'node:path';

/** Руты бывают строками или объектами {path, enabled}. */
const pathOf = (r) => (typeof r === 'string' ? r : String((r && (r.abs || r.path)) || ''));

export function buildRoots(config) {
  return (config.roots || []).map((r, i) => {
    const p = pathOf(r);
    let exists = false;
    let modules = [];
    try {
      exists = !!p && fs.existsSync(p) && fs.statSync(p).isDirectory();
      if (exists) {
        modules = fs
          .readdirSync(p, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => ({ name: d.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch {
      exists = false;
    }
    return { path: p, order: i, enabled: (r && r.enabled) !== false, exists, modules };
  });
}

export function buildModules(config, roots) {
  const map = new Map();
  const key = (root) => (process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root));
  const enabledRoots = new Map(roots.filter((root) => root.enabled).map((root) => [key(root.path), root.path]));
  for (const root of roots) {
    if (!root.enabled) continue;
    for (const m of root.modules) {
      if (!map.has(m.name))
        map.set(m.name, { name: m.name, roots: [], activeRoot: '', activeVia: '', selected: false });
      map.get(m.name).roots.push(root.path);
    }
  }
  for (const [name, m] of map) {
    const explicit = Object.hasOwn(config.moduleRoots || {}, name) ? config.moduleRoots[name] : null;
    // Содержимое папок уже прочитано buildRoots: повторный existsSync на каждый модуль не нужен.
    const chosen = explicit ? enabledRoots.get(key(explicit)) : null;
    m.selected = !!explicit;
    m.activeRoot = chosen || m.roots[0] || '';
    m.activeVia = chosen ? 'выбран пользователем' : 'первый рут с модулем';
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function firstSite(config) {
  return (config.sites || []).find((s) => s && s.enabled !== false) || (config.sites || [])[0] || null;
}
