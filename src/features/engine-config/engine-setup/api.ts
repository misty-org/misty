// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): lib/ipc.ts.
// See NOTICE.

import { useCallback } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { invoke } from "@/native/invoke";

export interface EngineSettings {
  binOverrides?: Record<string, unknown>;
  codexHome?: string | null;
  customModels?: Record<string, string[]>;
  [key: string]: unknown;
}

export const binKey = (engine: string) =>
  `${engine.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}Bin`;

const ENGINE_SETTINGS_KEY = "engine-config/settings";

const engineSettingsApi = {
  get: () => invoke<EngineSettings>("engine_settings_get"),
  async update(change: (settings: EngineSettings) => EngineSettings): Promise<EngineSettings> {
    const next = change(await invoke<EngineSettings>("engine_settings_get"));
    await invoke("engine_settings_set", { settings: next });
    return next;
  },
};

export function useEngineSettings() {
  const resource = useCachedResource(ENGINE_SETTINGS_KEY, engineSettingsApi.get, {
    persist: "device",
  });
  const { set } = resource;
  const save = useCallback(
    async (change: (settings: EngineSettings) => EngineSettings): Promise<string | null> => {
      try {
        set(await engineSettingsApi.update(change));
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [set],
  );
  const loadError =
    !resource.data && !resource.loading && resource.error
      ? resource.error instanceof Error
        ? resource.error.message
        : String(resource.error)
      : null;
  const { reload } = resource;
  const retry = useCallback(() => void reload(), [reload]);
  return { settings: resource.data ?? null, loadError, retry, save };
}
