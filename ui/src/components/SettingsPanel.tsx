/** Дополнительные настройки: live reload, вышестоящий прокси, что именно идёт через прокси. */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { Snapshot } from '../types.js';
import { Input } from '../ui/Input.js';
import { Panel, PanelHead, PanelHint, PanelTitle } from '../ui/Panel.js';
import { Switch } from './Switch.js';

export type SettingsPanelProps = {
  snap: Snapshot;
  onChanged: () => void;
};

export const SettingsPanel = ({ snap, onChanged }: SettingsPanelProps) => {
  const saved = snap.config?.upstreamProxy ?? '';
  const [upstream, setUpstream] = useState(saved);
  useEffect(() => setUpstream(saved), [saved]);

  const save = async (patch: Record<string, unknown>) => {
    await api.saveConfig(patch).catch(() => undefined);
    onChanged();
  };

  const hosts = snap.hosts;
  return (
    <Panel>
      <PanelHead>
        <PanelTitle>Дополнительно</PanelTitle>
        <PanelHint>{hosts === null ? 'через прокси идёт всё' : `через прокси: ${hosts.length} хост.`}</PanelHint>
      </PanelHead>

      {snap.cert.constraints.uncovered.length ? (
        <p className="text-xs text-warn" role="status">
          Сертификат не покрывает: {snap.cert.constraints.uncovered.join(', ')}.{' '}
          <button
            type="button"
            className="underline"
            onClick={() =>
              window.confirm(
                'Сертификат будет удалён, приложение закроется. При следующем запуске создастся новый и его нужно будет установить.',
              ) && void api.certReset()
            }
          >
            Перевыпустить
          </button>
        </p>
      ) : null}

      <label className="flex items-center justify-between gap-3 text-sm text-ink">
        <span>
          Перезагружать страницу при изменении файлов
          <span className="block text-xs text-ink-muted">CSS обновляется без перезагрузки</span>
        </span>
        <Switch checked={snap.liveReload} onChange={(v) => void save({ liveReload: v })} label="Live reload" />
      </label>

      <label className="flex flex-col gap-1 text-sm text-ink">
        Вышестоящий прокси
        <Input
          scale="xs"
          placeholder={snap.upstream ? `из системы: ${snap.upstream}` : 'host:port (пусто — напрямую)'}
          value={upstream}
          onChange={(e) => setUpstream(e.target.value)}
          onBlur={() => upstream.trim() !== saved && void save({ upstreamProxy: upstream.trim() })}
        />
      </label>
    </Panel>
  );
};
