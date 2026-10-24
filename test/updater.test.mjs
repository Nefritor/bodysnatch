import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { compareVersions, pickAsset } = createRequire(import.meta.url)('../shell/updater.cjs');

test('сравнение версий', () => {
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1);
  assert.equal(compareVersions('v0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('2.0.0-beta.1', '1.9.9'), 1);
});

test('выбор установщика под текущую платформу', () => {
  const assets = [
    { name: 'BodySnatch-0.1.1-win-x64.exe' },
    { name: 'BodySnatch-0.1.1-mac-arm64.dmg' },
    { name: 'BodySnatch-0.1.1-mac-x64.dmg' },
    { name: 'BodySnatch-0.1.1-win-x64.exe.blockmap' },
  ];
  const found = pickAsset(assets);
  if (process.platform === 'win32') assert.equal(found.name, 'BodySnatch-0.1.1-win-x64.exe');
  else if (process.platform === 'darwin') assert.match(found.name, new RegExp(`-mac-${process.arch}\.dmg$`));
  else assert.equal(found, undefined);
  assert.equal(pickAsset([]), undefined);
});
