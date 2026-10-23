/**
 * Правила маски: roots бывают и строками, и объектами — оба вида обязаны работать.
 * Регрессия: раньше строки превращались в "undefined" и подмена не срабатывала.
 *
 *   node test/rules.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rootsForSite, pickSite, resolveLocal } from '../proxy/src/rules.mjs';

const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

const tmp = path.join(os.tmpdir(), 'bs-rules-' + Date.now());
const moduleDir = path.join(tmp, 'Telephony_online', '_call');
fs.mkdirSync(moduleDir, { recursive: true });
fs.writeFileSync(path.join(moduleDir, 'Page.js'), '// локальная версия');

const site = {
  id: 'site',
  enabled: true,
  useLocal: true,
  files: [{ value: 'js', enabled: true }],
  mask: {
    prefixes: [{ value: 'fix', enabled: true }],
    envs: [{ value: 'cdn', enabled: true }],
    hosts: [{ value: 'sbis.ru', enabled: true }],
  },
  maps: [],
};
const url = new URL('https://fix-cdn.sbis.ru/static/resources/Telephony_online/_call/Page.js?x_module=abc');

// 1) roots строками (так их сохраняет интерфейс)
const cfgStrings = {
  roots: [tmp],
  moduleRoots: { Telephony_online: tmp },
  servicePrefixes: ['static/resources'],
  sites: [site],
};
check(
  'roots строками → путь сохраняется',
  JSON.stringify(rootsForSite(cfgStrings, site)) === JSON.stringify([tmp]),
  JSON.stringify(rootsForSite(cfgStrings, site)),
);

const picked = pickSite(cfgStrings, url.href);
check('сайт определяется по маске', !!picked);

const res = resolveLocal(cfgStrings, site, url);
check(
  'файл найден по строковому roots',
  res.file === path.join(tmp, 'Telephony_online', '_call', 'Page.js'),
  JSON.stringify(res),
);
check('файл существует', !!res.file && fs.existsSync(res.file));

// 2) roots объектами — старый вид тоже должен работать
const cfgObjects = {
  roots: [{ path: tmp, enabled: true }],
  moduleRoots: { Telephony_online: tmp },
  servicePrefixes: ['static/resources'],
  sites: [site],
};
check('roots объектами → путь сохраняется', JSON.stringify(rootsForSite(cfgObjects, site)) === JSON.stringify([tmp]));

// 3) выключенный рут игнорируется
const cfgOff = { roots: [{ path: tmp, enabled: false }], moduleRoots: {}, sites: [site] };
check('выключенный рут пропускается', rootsForSite(cfgOff, site).length === 0);

// 4) модуль не выбран — не подменяем
const cfgNoModule = { roots: [tmp], moduleRoots: {}, servicePrefixes: ['static/resources'], sites: [site] };
const noModule = resolveLocal(cfgNoModule, site, url);
check(
  'невыбранный модуль не подменяется',
  !noModule.file && /модуль не выбран/.test(noModule.reason || ''),
  JSON.stringify(noModule),
);

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {}

const passed = results.filter((r) => r.startsWith('ok')).length;
console.log(results.join('\n'));
console.log(`\n${passed}/${results.length} проверок прошло`);
process.exitCode = passed === results.length ? 0 : 1;
