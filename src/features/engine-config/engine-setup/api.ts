// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): lib/ipc.ts.
// See NOTICE.

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@/native/invoke";

/**
 * This device's engine settings as native code keeps them in misty.db (`engine_settings_get`),
 * never synced. Only the fields this page edits are typed; the rest pass through untouched.
 */
export interface EngineSettings {
  /** `{engine}Bin` → an absolute path to the program, instead of the one found on PATH. */
  binOverrides?: Record<string, unknown>;
  codexHome?: string | null;
  customModels?: Record<string, string[]>;
  dshHost?: string | null;
  dshPort?: number | null;
  dshAutoStart?: boolean | null;
  [key: string]: unknown;
}

/** The settings key of an engine's program path: `{engine}Bin` in camelCase (`qoderCnBin`). */
export const binKey = (engine: string) =>
  `${engine.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}Bin`;

export const engineSettingsApi = {
  get: () => invoke<EngineSettings>("engine_settings_get"),
  /** Applies `change` to a fresh read, never to a page's older copy, and stores it. Native code
   *  checks each program path and the Codex home before keeping them. */
  async update(change: (settings: EngineSettings) => EngineSettings): Promise<EngineSettings> {
    const next = change(await invoke<EngineSettings>("engine_settings_get"));
    await invoke("engine_settings_set", { settings: next });
    return next;
  },
};

/** The settings, and a save that reports its error instead of throwing. */
export function useEngineSettings() {
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  useEffect(() => {
    void engineSettingsApi
      .get()
      .then(setSettings)
      .catch(() => setSettings({}));
  }, []);
  const save = useCallback(
    async (change: (settings: EngineSettings) => EngineSettings): Promise<string | null> => {
      try {
        setSettings(await engineSettingsApi.update(change));
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    [],
  );
  return { settings, save };
}

// ── Pi and Oh My Pi ─────────────────────────────────────────────────────────

export interface PiFamilyAuthProviderSnapshot {
  id: string;
  envVar: string | null;
  state: "configured" | "none";
  /** Never the key: its ends with the middle masked. */
  maskedKey?: string | null;
  keySource?: string | null;
}

export interface PiFamilyAuthListResult {
  store: { path: string; kind: string; exists: boolean };
  providers: PiFamilyAuthProviderSnapshot[];
  /** Store ids holding a CLI-made sign-in. */
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

/** Pi's and Oh My Pi's own credential store and custom-provider file (`pi_family_auth.rs`). A key
 *  goes from the field straight into the CLI's store; reads carry only its masked ends. */
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

// ── DeepSeek Harness ────────────────────────────────────────────────────────

export interface DshHostStatus {
  installed: boolean;
  version: string | null;
  host: string;
  port: number;
  origin: string;
  autoStart: boolean;
  running: boolean;
  /** "spawned" when Misty started it, "adopted" when it was already running. */
  ownership: "spawned" | "adopted" | null;
  describe: Record<string, unknown> | null;
  webUrl: string | null;
  error: string | null;
}

/** The DeepSeek Harness host (`dsh_host.rs`): adopt one that is running, or start `dsh web`. */
export const dshHostApi = {
  status: () => invoke<DshHostStatus>("dsh_host_status"),
  start: () => invoke<DshHostStatus>("dsh_host_start"),
  stop: () => invoke<{ ok: boolean }>("dsh_host_stop"),
};
