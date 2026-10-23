/**
 * Выход «наверх»: напрямую или через вышестоящий прокси (корпоративный).
 *
 * Антивирус или корпоративный прокси часто вскрывают TLS и подписывают соединение
 * своим корнем. Windows и macOS такой корень знают, а Node доверяет только
 * встроенному набору, поэтому к нему добавляем системное хранилище.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

export function parseProxy(value) {
  const s = String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  const m = /^([^:\s]+):(\d{1,5})$/.exec(s);
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

function trustedRoots(log) {
  try {
    const system = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
    if (system && system.length) {
      log(`доверяем системным корням: +${system.length}`);
      return [...tls.rootCertificates, ...system];
    }
  } catch (e) {
    log('системные корни недоступны: ' + e.message);
  }
  return undefined;
}

/** HTTPS через HTTP CONNECT вышестоящего прокси. */
class TunnelAgent extends https.Agent {
  constructor(proxy, ca) {
    super({ keepAlive: true, maxSockets: 64 });
    this.proxy = proxy;
    this.caList = ca;
  }

  createConnection(options, cb) {
    connectThrough(this.proxy, options.host, options.port || 443).then(
      (socket) => {
        const secure = tls.connect({
          socket,
          servername: options.servername || options.host,
          ca: this.caList,
          ALPNProtocols: ['http/1.1'],
        });
        secure.once('secureConnect', () => cb(null, secure));
        secure.once('error', (e) => cb(e));
      },
      (e) => cb(e),
    );
  }
}

function connectThrough(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    let buf = '';
    const fail = (e) => {
      socket.destroy();
      reject(e);
    };
    socket.setTimeout(15000, () => fail(new Error('вышестоящий прокси не отвечает')));
    socket.once('error', fail);
    socket.once('connect', () => socket.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`));
    const onData = (chunk) => {
      buf += chunk.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.off('data', onData);
      socket.setTimeout(0);
      const code = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buf)?.[1]);
      if (code !== 200) return fail(new Error('вышестоящий прокси отказал: ' + (buf.split('\r\n')[0] || code)));
      const rest = Buffer.from(buf.slice(end + 4), 'latin1');
      if (rest.length) socket.unshift(rest);
      socket.removeListener('error', fail);
      resolve(socket);
    };
    socket.on('data', onData);
  });
}

/** @param {{ getProxy?: () => string, log?: (s: string) => void }} opts */
export function createUpstream({ getProxy = () => '', log = () => {} } = {}) {
  const ca = trustedRoots(log);
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, ...(ca ? { ca } : {}) });
  const tunnels = new Map();

  const tunnelAgent = (proxy) => {
    const key = `${proxy.host}:${proxy.port}`;
    if (!tunnels.has(key)) tunnels.set(key, new TunnelAgent(proxy, ca));
    return tunnels.get(key);
  };

  return {
    /** Запрос на целевой URL (URL-объект); options — как у http.request. */
    request(target, options, cb) {
      const proxy = parseProxy(getProxy());
      const isHttps = target.protocol === 'https:';
      const common = {
        ...options,
        // happy-eyeballs: у хоста есть IPv6, а сети по нему нет — Node уйдёт на IPv4
        autoSelectFamily: true,
        autoSelectFamilyAttemptTimeout: 800,
      };
      if (!proxy)
        return (isHttps ? https : http).request(target, { ...common, agent: isHttps ? httpsAgent : httpAgent }, cb);
      if (isHttps) return https.request(target, { ...common, agent: tunnelAgent(proxy) }, cb);
      return http.request(
        {
          ...common,
          host: proxy.host,
          port: proxy.port,
          path: target.href,
          headers: { ...(options.headers || {}), host: target.host },
          agent: httpAgent,
        },
        cb,
      );
    },

    /** Сырой туннель к host:port (для хостов, которые мы не вскрываем). */
    tunnel(host, port) {
      const proxy = parseProxy(getProxy());
      if (proxy) return connectThrough(proxy, host, port);
      return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port, autoSelectFamily: true });
        socket.once('connect', () => resolve(socket));
        socket.once('error', reject);
      });
    },

    close() {
      httpAgent.destroy();
      httpsAgent.destroy();
      for (const a of tunnels.values()) a.destroy();
    },
  };
}
