/** Конфигурация прокси: формат совместим с агентом расширения (rules.json). */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  port: 8180,
  certsDir: 'data/certs',
  /** служебные префиксы пути, которые не входят в локальный путь (например "static/resources") */
  servicePrefixes: [],
  roots: [],
  moduleRoots: {},
  sites: [],
};

export function loadConfig(file) {
  const abs = path.resolve(file);
  let raw = {};
  if (fs.existsSync(abs)) {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  }
  const cfg = { ...DEFAULT_CONFIG, ...raw };
  cfg.sites = Array.isArray(cfg.sites) ? cfg.sites : [];
  cfg.roots = Array.isArray(cfg.roots) ? cfg.roots : [];
  cfg.moduleRoots = cfg.moduleRoots && typeof cfg.moduleRoots === 'object' ? cfg.moduleRoots : {};
  cfg.servicePrefixes = Array.isArray(cfg.servicePrefixes)
    ? cfg.servicePrefixes.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  cfg.__path = abs;
  return cfg;
}

export function saveConfig(cfg) {
  const target = cfg.__path || cfg.configPath;
  if (!target) throw new Error('некуда сохранять конфиг');
  const { __path, ...rest } = cfg;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(rest, null, 2), 'utf8');
  return target;
}
