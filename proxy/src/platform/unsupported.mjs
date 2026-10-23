/** Платформы без поддержки системного прокси (Linux): прокси работает, но настраивать его нужно вручную. */
export const id = 'unsupported';

const no = () => {
  throw new Error('эта платформа не поддерживается: укажите PAC http://127.0.0.1:<порт>/proxy.pac вручную');
};

export const proxyState = async () => ({ pacUrl: '', manual: { enabled: false, server: '' } });
export const setPac = async () => no();
export const restoreProxy = async () => {};
export const openProxySettings = async () => {};
export const certTrusted = async () => false;
export const certInstall = async () => ({ ok: false, error: 'установите rootCA.pem в доверенные вручную' });
export const certUninstall = async () => ({ ok: false });
