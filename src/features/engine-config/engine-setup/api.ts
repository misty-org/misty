// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): lib/ipc.ts.
// See NOTICE.

import { useCallback } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { invoke } from "@/native/invoke";

export interface EngineSettings {
  binOverrides?: Record<string, unknown>;
  codexHome?: string | null;
  customModels?: Record<string, string[]>;
  dshHost?: string | null;
  dshPort?: number | null;
  dshAutoStart?: boolean | null;
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

export interface PiFamilyAuthProviderSnapshot {
  id: string;
  envVar: string | null;
  state: "configured" | "none";
  maskedKey?: string | null;
  keySource?: string | null;
}

export interface PiFamilyAuthListResult {
  store: { path: string; kind: string; exists: boolean };
  providers: PiFamilyAuthProviderSnapshot[];
  oauthProviders: string[];
}

export interface PiFamilyCustomProviderSummary {
  id: string;
  name: string | null;
  baseUrl: string | null;
  api: string | null;
  modelCount: number;
  hasApiKey: boolean;
}

export interface PiFamilyModelsConfigReadResult {
  file: { path: string; format: "json" | "yaml"; exists: boolean };
  text: string | null;
  template: string;
  providers: PiFamilyCustomProviderSummary[];
  parseError: string | null;
}

export const piFamilyApi = {
  list: (engine: "pi" | "omp") => invoke<PiFamilyAuthListResult>("pi_family_auth_list", { engine }),
  setApiKey: (engine: "pi" | "omp", providerId: string, key: string) =>
    invoke<void>("pi_family_auth_set_api_key", { engine, providerId, key }),
  deleteCredential: (engine: "pi" | "omp", providerId: string) =>
    invoke<void>("pi_family_auth_delete_credential", { engine, providerId }),
  readModels: (engine: "pi" | "omp") =>
    invoke<PiFamilyModelsConfigReadResult>("pi_family_models_config_read", { engine }),
  writeModels: (engine: "pi" | "omp", text: string) =>
    invoke<void>("pi_family_models_config_write", { engine, text }),
};

export interface DshHostStatus {
  installed: boolean;
  version: string | null;
  host: string;
  port: number;
  origin: string;
  autoStart: boolean;
  running: boolean;
  ownership: "spawned" | "adopted" | null;
  describe: Record<string, unknown> | null;
  webUrl: string | null;
  error: string | null;
}

export const dshHostApi = {
  status: () => invoke<DshHostStatus>("dsh_host_status"),
  start: () => invoke<DshHostStatus>("dsh_host_start"),
  stop: () => invoke<{ ok: boolean }>("dsh_host_stop"),
};
