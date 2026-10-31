/**
 * Сертификаты: корневой CA «BodySnatch Desktop» и листовые сертификаты для хостов.
 * Ключи делает нативный crypto (миллисекунды), подписывает node-forge.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import forge from 'node-forge';

const pki = forge.pki;
const DAY = 24 * 60 * 60 * 1000;

export const CA_NAME = 'BodySnatch Desktop Root CA';

/**
 * Базовые домены для ограничения CA: из хостов-шаблонов масок («fix-cdn.sbis.ru» → «sbis.ru»).
 * null — ограничивать нечем (маска перехватывает всё), тогда CA создаётся без ограничений.
 */
export function baseDomains(hostGlobs) {
  if (!hostGlobs || !hostGlobs.length) return null;
  const out = new Set();
  for (const glob of hostGlobs) {
    const labels = String(glob).toLowerCase().split('.');
    // co.uk, com.au: двухбуквенный TLD и короткий второй уровень
    const take = labels.length >= 3 && labels.at(-1).length === 2 && labels.at(-2).length <= 3 ? 3 : 2;
    const base = labels.slice(-take);
    if (base.length < take || base.some((l) => !l || l.includes('*') || l.includes('?'))) return null;
    out.add(base.join('.'));
  }
  return [...out].sort();
}

/** Хост входит в один из доменов (сам домен или его поддомен, как в RFC 5280). */
export function domainPermitted(host, domains) {
  if (!domains) return true;
  const h = String(host || '').toLowerCase();
  return domains.some((d) => h === d || h.endsWith('.' + d));
}

/** Расширение Name Constraints: разрешены только перечисленные DNS-домены. */
function nameConstraintsExtension(domains) {
  const asn1 = forge.asn1;
  const subtrees = domains.map((d) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, d), // dNSName
    ]),
  );
  const constraints = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, subtrees), // permittedSubtrees
  ]);
  return { id: '2.5.29.30', critical: true, value: asn1.toDer(constraints).getBytes() };
}

/** Пара RSA-ключей: нативная генерация, затем перевод в объекты forge. */
function newKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicKey: pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' })),
    privateKey: pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' })),
  };
}

/**
 * Корневой CA: читаем из папки, иначе создаём и сохраняем.
 *
 * `protector` ({encrypt(string)→Buffer|Promise, decrypt(Buffer)→string|Promise}) шифрует закрытый
 * ключ средствами ОС (DPAPI / Keychain через Electron safeStorage). Без него ключ
 * лежит в PEM-файле, доступном только владельцу.
 */
export async function ensureCA(dir, { protector = null, domains = null } = {}) {
  const certPath = path.join(dir, 'rootCA.pem');
  const keyPath = path.join(dir, 'rootCA.key.pem');
  const encPath = path.join(dir, 'rootCA.key.enc');
  const metaPath = path.join(dir, 'rootCA.meta.json');
  const readDomains = () => {
    try {
      const d = JSON.parse(fs.readFileSync(metaPath, 'utf8')).domains;
      return Array.isArray(d) && d.length ? d : null;
    } catch {
      return null; // CA прошлых версий: без ограничений
    }
  };

  const readKey = async () => {
    if (protector && fs.existsSync(encPath)) return protector.decrypt(fs.readFileSync(encPath));
    if (!protector && fs.existsSync(encPath) && !fs.existsSync(keyPath))
      throw new Error(
        'ключ CA зашифрован средствами ОС: запустите Electron с этим профилем или выберите отдельную папку сертификатов',
      );
    if (fs.existsSync(keyPath)) {
      const pem = fs.readFileSync(keyPath, 'utf8');
      // старый открытый ключ переводим в защищённый вид
      if (protector) {
        fs.writeFileSync(encPath, await protector.encrypt(pem), { mode: 0o600 });
        fs.rmSync(keyPath, { force: true });
      }
      return pem;
    }
    return null;
  };

  if (fs.existsSync(certPath)) {
    const keyPem = await readKey();
    if (keyPem) {
      const certPem = fs.readFileSync(certPath, 'utf8');
      return {
        certPem,
        keyPem,
        cert: pki.certificateFromPem(certPem),
        key: pki.privateKeyFromPem(keyPem),
        certPath,
        created: false,
        domains: readDomains(),
      };
    }
  }

  const keys = newKeyPair();
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Date.now().toString(16);
  cert.validity.notBefore = new Date(Date.now() - DAY);
  cert.validity.notAfter = new Date(Date.now() + 3650 * DAY);
  const attrs = [
    { name: 'commonName', value: CA_NAME },
    { name: 'organizationName', value: 'BodySnatch Desktop' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  const constrained = Array.isArray(domains) && domains.length > 0;
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    ...(constrained ? [nameConstraintsExtension(domains)] : []),
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = pki.certificateToPem(cert);
  const keyPem = pki.privateKeyToPem(keys.privateKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(certPath, certPem, 'utf8');
  if (protector) fs.writeFileSync(encPath, await protector.encrypt(keyPem), { mode: 0o600 });
  else fs.writeFileSync(keyPath, keyPem, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(metaPath, JSON.stringify({ domains: constrained ? domains : null }), 'utf8');
  return {
    certPem,
    keyPem,
    cert,
    key: keys.privateKey,
    certPath,
    created: true,
    domains: constrained ? domains : null,
  };
}

/** Удалить CA с диска (сертификат из хранилища системы снимает платформенный слой). */
export function removeCA(dir) {
  for (const name of [
    'rootCA.pem',
    'rootCA.key.pem',
    'rootCA.key.enc',
    'rootCA.meta.json',
    'BodySnatch Desktop Root CA.crt',
  ]) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
}

/**
 * Листовой сертификат для хоста, подписанный CA.
 * Один ключ на все хосты (он не покидает машину), поэтому выпуск — это только подпись.
 */
export function createLeafIssuer(ca) {
  const leafKeys = newKeyPair();
  const leafKeyPem = pki.privateKeyToPem(leafKeys.privateKey);
  const cache = new Map();

  return function leafFor(host) {
    const name = String(host || '').toLowerCase();
    if (!name) throw new Error('пустой хост');
    if (cache.has(name)) return cache.get(name);

    const cert = pki.createCertificate();
    cert.publicKey = leafKeys.publicKey;
    cert.serialNumber = '02' + Date.now().toString(16) + Math.floor(Math.random() * 0xffffff).toString(16);
    cert.validity.notBefore = new Date(Date.now() - DAY);
    // Apple не принимает листовые сертификаты дольше 398 дней
    cert.validity.notAfter = new Date(Date.now() + 397 * DAY);
    cert.setSubject([{ name: 'commonName', value: name.slice(0, 64) }]);
    cert.setIssuer(ca.cert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [net.isIP(name) ? { type: 7, ip: name } : { type: 2, value: name }],
      },
    ]);
    cert.sign(ca.key, forge.md.sha256.create());

    const out = { certPem: pki.certificateToPem(cert), keyPem: leafKeyPem };
    if (cache.size > 2000) cache.clear();
    cache.set(name, out);
    return out;
  };
}
