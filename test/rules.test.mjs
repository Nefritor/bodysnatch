import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  pickSite,
  hostMatches,
  resolveLocal,
  touchConfig,
  compile,
  relForSite,
  hostOfPattern,
} from '../proxy/src/rules.mjs';
import { buildPac } from '../proxy/src/pac.mjs';
import { normalizeConfig } from '../proxy/src/config.mjs';
import { tmpdir } from './helpers.mjs';

const maskSite = (extra = {}) => ({
  id: 'site',
  enabled: true,
  mask: {
    prefixes: [
      { value: 'fix', enabled: true },
      { value: 'отсутствует', enabled: true },
    ],
    envs: [{ value: 'cdn', enabled: true }],
    hosts: [{ value: 'sbis.ru', enabled: true }],
  },
  ...extra,
});

test('маска «префикс × окружение × хост» даёт нужные URL', () => {
  const config = normalizeConfig({ sites: [maskSite()] });
  assert.ok(pickSite(config, 'https://fix-cdn.sbis.ru/static/a.js'));
  assert.ok(pickSite(config, 'https://cdn.sbis.ru/a.js'));
  assert.equal(pickSite(config, 'https://other.sbis.ru/a.js'), null);
  assert.equal(pickSite(config, 'https://fix-cdn.evil.ru/a.js'), null);
});

test('hostMatches и PAC строятся из одних и тех же масок', () => {
  const config = normalizeConfig({ sites: [maskSite()] });
  assert.equal(hostMatches(config, 'fix-cdn.sbis.ru'), true);
  assert.equal(hostMatches(config, 'bank.example.com'), false);
  const pac = buildPac(config, 8180);
  assert.match(pac, /shExpMatch\(host, "fix-cdn\.sbis\.ru"\)/);
  assert.match(pac, /PROXY 127\.0\.0\.1:8180; DIRECT/);
  assert.match(pac, /return "DIRECT"/);
});

test('PAC: корпоративный прокси остаётся запасным маршрутом', () => {
  const config = normalizeConfig({ sites: [maskSite()] });
  const pac = buildPac(config, 8180, 'PROXY corp:3128; DIRECT');
  assert.match(pac, /return "PROXY corp:3128; DIRECT"/);
});

test('шаблон без схемы заставляет перехватывать всё', () => {
  const config = normalizeConfig({ sites: [{ id: 's', enabled: true, match: ['*'] }] });
  assert.equal(compile(config).hostGlobs, null);
  assert.equal(hostMatches(config, 'anything.test'), true);
  assert.equal(hostOfPattern('*://*.a.ru/path'), '*.a.ru');
});

test('правка маски действует сразу: кэш сбрасывается через touchConfig', () => {
  const config = normalizeConfig({ sites: [maskSite()] });
  assert.ok(pickSite(config, 'https://fix-cdn.sbis.ru/a.js'));
  config.sites[0].mask.hosts = [{ value: 'saby.ru', enabled: true }];
  touchConfig(config);
  assert.equal(pickSite(config, 'https://fix-cdn.sbis.ru/a.js'), null);
  assert.ok(pickSite(config, 'https://fix-cdn.saby.ru/a.js'));
});

test('битая %-последовательность не роняет разбор пути', () => {
  assert.equal(relForSite({}, new URL('https://h.test/%E0%A4%A')), null);
  assert.equal(relForSite({}, new URL('https://h.test/a%20b.js')), 'a b.js');
});

test('поле «Файлы»: подменяются только выбранные расширения', () => {
  const root = tmpdir('ext');
  fs.mkdirSync(path.join(root, 'mod'));
  for (const f of ['a.js', 'a.css', 'a.tmpl', 'b.min.js']) fs.writeFileSync(path.join(root, 'mod', f), 'x');
  const config = normalizeConfig({ roots: [root], moduleRoots: { mod: root } });
  const at = (site, p) => resolveLocal(config, site, new URL('https://h.test' + p));
  const only = (...values) => ({ useLocal: true, files: values.map((value) => ({ value, enabled: true })) });

  assert.ok(at(only('js', 'css'), '/mod/a.js').file);
  assert.ok(at(only('js', 'css'), '/mod/a.css').file);
  assert.equal(at(only('js', 'css'), '/mod/a.tmpl').reason, 'расширение не выбрано');
  assert.ok(at(only('js', 'css', 'tmpl'), '/mod/a.tmpl').file, 'расширение добавили — подмена пошла');
  assert.ok(at(only('.JS'), '/mod/b.js').file, 'точка и регистр не важны, .min находится');
  assert.equal(
    at({ useLocal: true, files: [{ value: 'js', enabled: false }] }, '/mod/a.js').reason,
    'расширение не выбрано',
  );
  assert.ok(at({ useLocal: true }, '/mod/a.tmpl').file, 'без списка фильтра нет');
});

test('resolveLocal: файл, .min-вариант, выход за корень, неверный модуль', () => {
  const root = tmpdir('rules');
  fs.mkdirSync(path.join(root, 'mod'));
  fs.writeFileSync(path.join(root, 'mod', 'a.js'), 'x');
  fs.writeFileSync(path.join(root, 'mod', 'b.min.js'), 'y');
  const config = normalizeConfig({ roots: [root], moduleRoots: { mod: root }, servicePrefixes: ['static/resources'] });
  const site = { useLocal: true };
  const at = (p) => resolveLocal(config, site, new URL('https://h.test' + p));

  assert.equal(at('/static/resources/mod/a.js').file, path.join(root, 'mod', 'a.js'));
  assert.equal(at('/mod/b.js').via, 'mirror-min');
  assert.ok(at('/mod/none.js').missing);
  assert.equal(at('/other/a.js').reason, 'модуль не выбран');
  assert.equal(at('/mod/%E0%A4%A').reason, 'некорректный путь');
  assert.ok(!at('/mod/..%2f..%2fsecret.txt').file);
});
