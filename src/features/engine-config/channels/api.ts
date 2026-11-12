// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { invoke } from "@/native/invoke";

/** One saved channel as native code shows it: everything but its key. */
export interface ChannelView {
  id: string;
  config: unknown;
  /** Whether a key is saved for it in the keychain. The key itself never comes back. */
  hasKey: boolean;
}

export interface EngineChannels {
  engine: string;
  channels: ChannelView[];
  current: string | null;
  enabled: boolean;
}

export interface OfficialConfigFile {
  path: string;
  format: "json" | "toml";
  content: string;
  exists: boolean;
}

export interface OfficialConfigDraft {
  path: string;
  content: string;
}

export interface ProviderModelList {
  models: string[];
  endpoint: string;
}

export interface CcSwitchStatus {
  installed: boolean;
  changed: boolean;
  providers: number;
  hash: string;
  modifiedMs: number;
}

export interface CcSwitchImportResult {
  added: number;
  updated: number;
  skipped: number;
  removed: number;
}

export const channelsApi = {
  list: () => invoke<EngineChannels[]>("engine_channels_list"),
  /** Adds or replaces a channel. A key in it goes to the keychain; `clearKey: true` removes it. */
  upsert: (engine: string, id: string, json: Record<string, unknown>) =>
    invoke<void>("engine_channels_upsert", { engine, id, json }),
  remove: (engine: string, id: string) => invoke<void>("engine_channels_delete", { engine, id }),
  setEnabled: (engine: string, enabled: boolean) =>
    invoke<void>("engine_channels_set_enabled", { engine, enabled }),
  setCurrent: (engine: string, id: string) =>
    invoke<void>("engine_channels_set_current", { engine, id }),
  reorder: (engine: string, ids: string[]) =>
    invoke<void>("engine_channels_reorder", { engine, ids }),
  /** A channel's model list. With `id`, its saved base URL and key are used in native code. */
  models: (engine: string, args: { id?: string; baseUrl?: string; apiKey?: string }) =>
    invoke<ProviderModelList>("engine_channels_models", {
      engine,
      id: args.id ?? null,
      baseUrl: args.baseUrl ?? null,
      apiKey: args.apiKey ?? null,
    }),
  officialPaths: (engine: string) => invoke<string[]>("engine_channels_official_paths", { engine }),
  officialRead: (engine: string) =>
    invoke<OfficialConfigFile[]>("engine_channels_official_read", { engine }),
  officialWrite: (engine: string, files: OfficialConfigDraft[]) =>
    invoke<void>("engine_channels_official_write", { engine, files }),
  ccSwitchCheck: () => invoke<CcSwitchStatus>("engine_cc_switch_check"),
  ccSwitchDismiss: (hash: string) => invoke<void>("engine_cc_switch_dismiss", { hash }),
  ccSwitchImport: (engine: string) =>
    invoke<CcSwitchImportResult>("engine_cc_switch_import", { engine }),
  /** Opens the system's file dialog in native code; null when cancelled. */
  ccSwitchImportFile: (engine: string) =>
    invoke<CcSwitchImportResult | null>("engine_cc_switch_import_file", { engine }),
};
