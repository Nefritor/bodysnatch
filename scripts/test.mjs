/**
 * Тесты по группам: запускается только то, что затронуто изменениями.
 *
 *   node scripts/test.mjs                 — группы, затронутые с прошлого запуска
 *   node scripts/test.mjs ui proxy        — конкретные группы
 *   node scripts/test.mjs --all           — все быстрые группы
 *   node scripts/test.mjs --all --slow    — вместе с browser/release
 *   node scripts/test.mjs --list          — состав групп
 *
 * Изменения определяются без git: кэш хранит mtime и размер каждого файла,
 * поэтому «затронутые» — те, что правились с прошлого прогона.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('.');
const CACHE = path.join(ROOT, '.cache', 'test-state.json');

/**
 * Группа = набор тестов + пути, изменения в которых её затрагивают.
 * slow: true — нужен Chrome, сеть или сборка, по умолчанию пропускается.
 */
const GROUPS = {
  rules: {
    tests: ['rules'],
    paths: ['proxy/src/rules.mjs', 'proxy/src/config.mjs', 'config/rules.json'],
  },
  proxy: {
    tests: ['proxy', 'css-passthrough', 'log', 'self-loop', 'proxy-off'],
    paths: ['proxy/src/proxy.mjs', 'proxy/src/api.mjs', 'proxy/src/rules.mjs', 'proxy/src/config.mjs'],
  },
  cert: {
    tests: ['cert-trust', 'cert-install'],
    paths: ['proxy/src/certinstall.mjs', 'proxy/src/ca.mjs'],
  },
  sysproxy: {
    tests: ['sysproxy'],
    paths: ['proxy/src/sysproxy.mjs', 'proxy-elevated.ps1'],
  },
  watchdog: {
    tests: ['watchdog'],
    paths: ['proxy/src/main.mjs', 'proxy/src/sysproxy.mjs'],
  },
  ui: {
    tests: ['ui'],
    paths: ['ui/src/**', 'ui/index.html', 'vite.config.ts'],
  },
  shell: {
    tests: ['shell'],
    paths: ['shell/**'],
  },
  browser: {
    tests: ['browser', 'realcase'],
    paths: ['proxy/src/**', 'config/rules.json', 'ui/src/**'],
    slow: true,
  },
  release: {
    tests: ['release'],
    paths: ['scripts/package-electron.mjs', 'shell/**', 'ui/src/**', 'proxy/src/**'],
    slow: true,
  },
};

/** Простое сопоставление glob → regex: ** — любая глубина, * — в пределах сегмента. */
const globToRe = (glob) =>
  new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '.*') +
      '$',
  );

const matches = (file, globs) => globs.some((g) => globToRe(g).test(file));

const walk = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.cache', 'dist', 'release', 'build', 'data', 'shots'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return acc;
};

const loadCache = () => {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
};

const currentState = () => {
  const state = {};
  for (const file of walk(ROOT)) {
    try {
      const st = fs.statSync(path.join(ROOT, file));
      state[file] = `${st.mtimeMs}:${st.size}`;
    } catch {
      /* файл исчез */
    }
  }
  return state;
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const names = args.filter((a) => !a.startsWith('--'));

if (flags.has('--list')) {
  for (const [name, g] of Object.entries(GROUPS)) {
    console.log(`${name.padEnd(9)} ${g.tests.join(', ')}${g.slow ? '  (медленная)' : ''}`);
  }
  process.exit(0);
}

const state = currentState();
const prevCache = loadCache();
const prevKeys = Object.keys(prevCache);
const changed = Object.keys(state).filter((f) => prevCache[f] !== state[f]);

let selected;
if (names.length) {
  selected = names;
} else if (flags.has('--all')) {
  selected = Object.keys(GROUPS);
} else {
  selected = Object.keys(GROUPS).filter((name) => {
    const g = GROUPS[name];
    if (g.slow && !flags.has('--slow')) return false;
    if (!prevKeys.length) return !g.slow; // первый запуск без кэша
    return changed.some((file) => matches(file, g.paths));
  });
}

const unknown = selected.filter((name) => !GROUPS[name]);
if (unknown.length) {
  console.error(`Неизвестные группы: ${unknown.join(', ')}`);
  console.error(`Доступны: ${Object.keys(GROUPS).join(', ')}`);
  process.exit(1);
}

if (!names.length && !flags.has('--all')) {
  if (!selected.length) {
    console.log('В коде нет изменений — тесты не требуются.');
    console.log('Принудительно: node scripts/test.mjs --all');
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(state), 'utf8');
    process.exit(0);
  }
  console.log(`Затронуто файлов: ${changed.length} · группы: ${selected.join(', ')}`);
}

const files = [...new Set(selected.flatMap((name) => GROUPS[name].tests))];
let failed = 0;
for (const name of files) {
  const file = path.join(ROOT, 'test', `${name}.test.mjs`);
  if (!fs.existsSync(file)) {
    console.log(`\n=== ${name} === пропущен (нет файла)`);
    continue;
  }
  process.stdout.write(`\n=== ${name} ===\n`);
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}

// кэш пишем после прогона: тесты сами трогают config/rules.json и подобное,
// иначе следующий запуск снова увидел бы «изменения»
fs.mkdirSync(path.dirname(CACHE), { recursive: true });
fs.writeFileSync(CACHE, JSON.stringify(currentState()), 'utf8');

process.stdout.write(`\n${files.length - failed}/${files.length} наборов прошло\n`);
process.exit(failed === 0 ? 0 : 1);
