/** Прямые HTTP/HTTPS-запросы и TCP-туннели к сайтам. */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

function trustedRoots(log) {
  try {
    const system = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
    if (system?.length) return [...tls.rootCertificates, ...system];
  } catch (error) {
    log('системные корни недоступны: ' + error.message);
  }
  return undefined;
}

export function createUpstream({ log = () => {} } = {}) {
  const ca = trustedRoots(log);
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, ...(ca ? { ca } : {}) });
  return {
    request(target, options, cb) {
      const isHttps = target.protocol === 'https:';
      return (isHttps ? https : http).request(
        target,
        {
          ...options,
          autoSelectFamily: true,
          autoSelectFamilyAttemptTimeout: 800,
          agent: isHttps ? httpsAgent : httpAgent,
        },
        cb,
      );
    },
    tunnel(host, port) {
      return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port, autoSelectFamily: true });
        socket.setTimeout(15000, () => socket.destroy(new Error('таймаут CONNECT')));
        socket.once('connect', () => {
          socket.setTimeout(0);
          resolve(socket);
        });
        socket.once('error', reject);
      });
    },
    close() {
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}
