/** Конфигурация прокси: формат совместим с агентом расширения (rules.json). */
import fs from 'node:fs';
import path from 'node:path';
import { touchConfig } from './rules.mjs';

export const DEFAULT_CONFIG = {
  port: 8180,
  /** служебные префиксы пути, которые не входят в локальный путь (например "static/resources") */
  servicePrefixes: [],
  roots: [],
  moduleRoots: {},
  sites: [],
};

export function normalizeConfig(raw) {
  const cfg = { ...structuredClone(DEFAULT_CONFIG), ...raw };
  cfg.sites = Array.isArray(cfg.sites) ? cfg.sites : [];
  cfg.roots = Array.isArray(cfg.roots) ? cfg.roots : [];
  cfg.moduleRoots = cfg.moduleRoots && typeof cfg.moduleRoots === 'object' ? cfg.moduleRoots : {};
  cfg.servicePrefixes = Array.isArray(cfg.servicePrefixes)
    ? cfg.servicePrefixes.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  // Удалённые настройки старых версий не попадают обратно в сохраняемый конфиг.
  delete cfg.upstreamProxy;
  delete cfg.liveReload;
  return cfg;
}

export function loadConfig(file, fallbackFile = null) {
  const abs = path.resolve(file);
  let raw = {};
  const source = fs.existsSync(abs) ? abs : fallbackFile && fs.existsSync(fallbackFile) ? fallbackFile : null;
  if (source) raw = JSON.parse(fs.readFileSync(source, 'utf8'));
  const cfg = normalizeConfig(raw);
  cfg.__path = abs;
  return cfg;
}

/** Атомарная запись: при сбое посреди записи старый файл остаётся целым. */
export function saveConfig(cfg) {
  const target = cfg.__path;
  if (!target) throw new Error('некуда сохранять конфиг');
  const persistent = Object.fromEntries(Object.entries(cfg).filter(([k]) => !k.startsWith('__')));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(persistent, null, 2), 'utf8');
  fs.renameSync(tmp, target);
  touchConfig(cfg);
  return target;
}
