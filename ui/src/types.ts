/** Типы интерфейса BodySnatch Desktop (ответы MITM-прокси). */

export type MaskOption = { value: string; enabled: boolean; custom?: boolean };

export type SiteMask = { prefixes: MaskOption[]; envs: MaskOption[]; hosts: MaskOption[]; extra?: string[] };

export type RootInfo = {
  path: string;
  order: number;
  enabled: boolean;
  exists: boolean;
  modules: { name: string }[];
};

export type ModuleInfo = {
  name: string;
  roots: string[];
  activeRoot: string;
  activeVia: string;
  selected?: boolean;
};

export type SiteConfig = {
  id?: string;
  enabled?: boolean;
  match?: string[];
  root?: string;
  basePath?: string;
  files?: MaskOption[];
  mask?: SiteMask;
  useLocal?: boolean;
  maps?: { match: string; file: string; enabled?: boolean }[];
};

export type Config = {
  roots?: (string | { path: string; enabled?: boolean })[];
  moduleRoots?: Record<string, string>;
  sites: SiteConfig[];
  upstreamProxy?: string;
  liveReload?: boolean;
};

export type SystemProxy = { enabled: boolean; server: string; override: string; ours: boolean; pacUrl?: string };

export type CertState = {
  trusted: boolean;
  thumbprint: string;
  certPath: string;
  created: boolean;
  /** на какие домены ограничен корневой сертификат */
  constraints: { constrained: boolean; domains: string[]; uncovered: string[]; canTighten: boolean };
};

/** Снимок состояния прокси — то, что отдаёт GET /api/state. */
export type Snapshot = {
  ok: boolean;
  version: string;
  enabled: boolean;
  configPath: string;
  config?: Config;
  sites: SiteConfig[];
  roots: RootInfo[];
  modules: ModuleInfo[];
  moduleRoots: Record<string, string>;
  mask: SiteMask;
  files: MaskOption[];
  port: number;
  stats: { local: number; remote: number };
  cert: CertState;
  systemProxy: SystemProxy;
  platform: string;
  /** адрес PAC, который получает система */
  pacUrl: string;
  /** хосты, которые идут через прокси; null — все */
  hosts: string[] | null;
  /** вышестоящий прокси, если он есть */
  upstream: string;
  liveReload: boolean;
};

export type LogEntry = {
  /** порядковый номер записи: стабильный ключ строки */
  id?: number;
  t: string;
  via: string;
  status: number;
  url: string;
  note?: string;
  bytes?: number;
  /** модуль, к которому относится подменённый файл */
  module?: string;
  /** полный путь к локальному файлу */
  file?: string;
};
