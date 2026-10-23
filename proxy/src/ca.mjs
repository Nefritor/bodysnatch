/**
 * Сертификаты: корневой CA «BodySnatch Desktop» и листовые сертификаты для хостов.
 * Всё генерируется в чистом JS (node-forge), без внешних утилит.
 */
import fs from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';

const pki = forge.pki;

const DAYS = 24 * 60 * 60 * 1000;

/** Корневой CA: читаем из папки, иначе создаём и сохраняем. */
export function ensureCA(dir) {
  const certPath = path.join(dir, 'rootCA.pem');
  const keyPath = path.join(dir, 'rootCA.key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const keyPem = fs.readFileSync(keyPath, 'utf8');
    return {
      certPem,
      keyPem,
      cert: pki.certificateFromPem(certPem),
      key: pki.privateKeyFromPem(keyPem),
      certPath,
      keyPath,
      created: false,
    };
  }

  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Date.now().toString(16);
  cert.validity.notBefore = new Date(Date.now() - DAYS);
  cert.validity.notAfter = new Date(Date.now() + 3650 * DAYS);
  const attrs = [
    { name: 'commonName', value: 'BodySnatch Desktop Root CA' },
    { name: 'organizationName', value: 'BodySnatch Desktop' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = pki.certificateToPem(cert);
  const keyPem = pki.privateKeyToPem(keys.privateKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(certPath, certPem, 'utf8');
  fs.writeFileSync(keyPath, keyPem, 'utf8');
  return { certPem, keyPem, cert, key: keys.privateKey, certPath, keyPath, created: true };
}

/**
 * Листовой сертификат для хоста, подписанный CA.
 * Один ключ на все хосты (он не покидает машину) — так выпуск сертификата
 * занимает миллисекунды, а не сотни миллисекунд на генерацию ключа.
 */
export function createLeafIssuer(ca) {
  const leafKeys = pki.rsa.generateKeyPair(2048);
  const cache = new Map();

  return function leafFor(host) {
    const name = String(host || '').toLowerCase();
    if (!name) throw new Error('пустой хост');
    if (cache.has(name)) return cache.get(name);

    const cert = pki.createCertificate();
    cert.publicKey = leafKeys.publicKey;
    cert.serialNumber = '02' + Date.now().toString(16) + Math.floor(Math.random() * 0xffff).toString(16);
    cert.validity.notBefore = new Date(Date.now() - DAYS);
    cert.validity.notAfter = new Date(Date.now() + 397 * DAYS);
    cert.setSubject([{ name: 'commonName', value: name }]);
    cert.setIssuer(ca.cert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: name }] },
    ]);
    cert.sign(ca.key, forge.md.sha256.create());

    const out = { certPem: pki.certificateToPem(cert), keyPem: pki.privateKeyToPem(leafKeys.privateKey) };
    cache.set(name, out);
    return out;
  };
}
