import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { browserArgs, browserCandidates, findBrowser, spkiHash } from '../proxy/src/browser.mjs';
import { parseScutilProxy } from '../proxy/src/platform/darwin.mjs';

const makeCert = () => {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 1000);
  cert.validity.notAfter = new Date(Date.now() + 1e9);
  const attrs = [{ name: 'commonName', value: 'test' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey);
  return { pem: forge.pki.certificateToPem(cert), keys };
};

test('spkiHash — SHA-256 от SPKI в base64', () => {
  const { pem, keys } = makeCert();
  const der = Buffer.from(forge.asn1.toDer(forge.pki.publicKeyToAsn1(keys.publicKey)).getBytes(), 'binary');
  assert.equal(spkiHash(pem), createHash('sha256').update(der).digest('base64'));
});

test('browserArgs: PAC, профиль и доверие к корню', () => {
  const args = browserArgs({ pacUrl: 'http://127.0.0.1:8180/proxy.pac', spki: 'AAA=', profileDir: '/p' });
  assert.ok(args.includes('--proxy-pac-url=http://127.0.0.1:8180/proxy.pac'));
  assert.ok(args.includes('--ignore-certificate-errors-spki-list=AAA='));
  assert.ok(args.includes('--user-data-dir=/p'));
});

test('findBrowser: Chrome раньше Edge, нет браузеров — null', () => {
  const env = { ProgramFiles: 'C:\PF', LOCALAPPDATA: 'C:\L' };
  const all = browserCandidates('win32', env);
  assert.equal(all[0].name, 'Chrome');
  const edgeOnly = findBrowser('win32', env, '', (p) => p.includes('msedge'));
  assert.equal(edgeOnly.name, 'Edge');
  assert.equal(
    findBrowser('win32', env, '', () => false),
    null,
  );
  assert.equal(
    findBrowser('darwin', {}, '/Users/u', (p) => p.startsWith('/Applications/Google Chrome')).name,
    'Chrome',
  );
  assert.deepEqual(browserCandidates('linux'), []);
});

test('scutil --proxy: с VPN PAC пустой, без VPN — наш', () => {
  const vpn = '<dictionary> {\n  ExceptionsList : <array> {\n    0 : *.local\n  }\n  FTPPassive : 1\n}';
  assert.equal(parseScutilProxy(vpn).pacUrl, '');
  const ok =
    '<dictionary> {\n  ProxyAutoConfigEnable : 1\n  ProxyAutoConfigURLString : http://127.0.0.1:8180/proxy.pac?v=ab12\n}';
  assert.equal(parseScutilProxy(ok).pacUrl, 'http://127.0.0.1:8180/proxy.pac?v=ab12');
  assert.equal(parseScutilProxy('ProxyAutoConfigEnable : 0\nProxyAutoConfigURLString : http://x/y').pacUrl, '');
});
