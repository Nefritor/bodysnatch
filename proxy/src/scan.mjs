/** Скан папок: руты, модули, маска — то, что показывает интерфейс. */
import fs from 'node:fs';

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
  for (const root of roots) {
    for (const m of root.modules) {
      if (!map.has(m.name))
        map.set(m.name, { name: m.name, roots: [], activeRoot: '', activeVia: '', selected: false });
      map.get(m.name).roots.push(root.path);
    }
  }
  for (const [name, m] of map) {
    const explicit = (config.moduleRoots || {})[name];
    m.selected = !!explicit;
    m.activeRoot = explicit || m.roots[0] || '';
    m.activeVia = explicit ? 'выбран пользователем' : 'первый рут';
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function firstSite(config) {
  return (config.sites || []).find((s) => s && s.enabled !== false) || (config.sites || [])[0] || null;
}
