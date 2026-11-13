// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/** The channel model behind Settings › Engines › Channels. */

import type { ChannelView, EngineChannels } from "./api";
import type { EngineId } from "./engines";

export const PSEUDO_LOCAL = "__local_settings_json__";
export const PSEUDO_DISABLED = "__disabled__";

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** The channel's environment: settingsConfig.env wins over the flat env, since native code lets
 *  raw env override flat fields and the more specific shape is the one that applies. */
function channelEnv(raw: unknown): Record<string, unknown> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flat = o.env && typeof o.env === "object" ? (o.env as Record<string, unknown>) : {};
  const settings = (o.settingsConfig as Record<string, unknown> | undefined)?.env;
  const nested =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  return { ...flat, ...nested };
}

/** Per-engine model variable, mirroring native provider_files::env_mapping(). */
const ENV_MODEL_KEY: Partial<Record<EngineId, string>> = {
  claude: "ANTHROPIC_MODEL",
  kimi: "KIMI_MODEL_NAME",
  grok: "GROK_MODEL",
  codebuddy: "CODEBUDDY_MODEL",
  gemini: "GEMINI_MODEL",
  qwen: "OPENAI_MODEL",
};

/**
 * Model id for the picker: the flat `model` field first, then the legacy
 * imported shape (`settingsConfig.env.<ENGINE_MODEL_VAR>` / `env.<…>`).
 */
function providerModel(engine: EngineId, raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flat = asString(o.model).trim();
  if (flat) return flat;
  const key = ENV_MODEL_KEY[engine];
  if (!key) return "";
  return asString(channelEnv(raw)[key]).trim();
}

/**
 * Per-engine variables behind the flat baseUrl/apiKey/model fields, mirroring native
 * provider_files::env_mapping(). Imported CC Switch channels carry these inside
 * settingsConfig.env/env, and native code lets raw env win over flat fields, so an edit must
 * strip them or the new values have no effect.
 */
const ENV_CONVENTION_KEYS: Partial<Record<EngineId, string[]>> = {
  claude: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"],
  kimi: ["KIMI_BASE_URL", "KIMI_API_KEY", "KIMI_MODEL_NAME"],
  grok: ["GROK_BASE_URL", "GROK_API_KEY", "GROK_MODEL"],
  codex: ["OPENAI_BASE_URL", "OPENAI_API_KEY"],
  // CODEBUDDY_INTERNET_ENVIRONMENT is deliberately not here: the channel form has no field for
  // it, so stripping it would delete it from imported dedicated or self-hosted channels.
  codebuddy: ["CODEBUDDY_BASE_URL", "CODEBUDDY_API_KEY", "CODEBUDDY_MODEL"],
  gemini: ["GOOGLE_GEMINI_BASE_URL", "GEMINI_API_KEY", "GEMINI_MODEL"],
  qwen: ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"],
};

/** Copy `raw` with the convention env keys removed (empty maps/objects
 *  dropped), so edited flat fields take effect. Unknown keys are preserved. */
export function stripConventionEnv(engine: EngineId, raw: unknown): Record<string, unknown> {
  const keys = ENV_CONVENTION_KEYS[engine];
  const o = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (!keys) return o;
  const keySet = new Set(keys);
  const strip = (env: unknown): Record<string, unknown> | undefined => {
    if (!env || typeof env !== "object") return undefined;
    const rest = Object.fromEntries(
      Object.entries(env as Record<string, unknown>).filter(([k]) => !keySet.has(k)),
    );
    return Object.keys(rest).length > 0 ? rest : undefined;
  };
  const env = strip(o.env);
  if (env) o.env = env;
  else delete o.env;
  if (o.settingsConfig && typeof o.settingsConfig === "object") {
    const sc = { ...(o.settingsConfig as Record<string, unknown>) };
    const scEnv = strip(sc.env);
    if (scEnv) sc.env = scEnv;
    else delete sc.env;
    if (Object.keys(sc).length > 0) o.settingsConfig = sc;
    else delete o.settingsConfig;
  }
  return o;
}

/** Claude Code edit-dialog seed: the channel's settings.json text — its
 *  settingsConfig, or the flat env escape hatch wrapped in an object.
 *  "" when neither exists (the dialog falls back to the default template). */
export function claudeSettingsJson(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig;
  if (sc && typeof sc === "object" && Object.keys(sc).length > 0) {
    return JSON.stringify(sc, null, 2);
  }
  const env = o.env;
  if (env && typeof env === "object" && Object.keys(env).length > 0) {
    return JSON.stringify({ env }, null, 2);
  }
  return "";
}

/** Codex edit-dialog seed: the channel's verbatim config.toml
 *  (settingsConfig.config), "" for flat channels. */
export function codexConfigToml(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig as Record<string, unknown> | undefined;
  return asString(sc?.config);
}

/** Codex edit-dialog seed: the channel's auth.json text
 *  (settingsConfig.auth pretty-printed), "" when absent. */
export function codexAuthJson(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig as Record<string, unknown> | undefined;
  const auth = sc?.auth;
  if (auth && typeof auth === "object" && Object.keys(auth).length > 0) {
    return JSON.stringify(auth, null, 2);
  }
  return "";
}

/** One channel row of an engine, flattened for the interface. */
export interface ProviderEntry {
  /** The id `engine_channels_set_current` expects. */
  id: string;
  name: string;
  remark: string;
  baseUrl: string;
  model: string;
  /** Whether a key is saved in the keychain. Windows never see the key. */
  hasKey: boolean;
  /** The stored record, merged back on save so unknown fields survive. */
  raw: unknown;
}

/** The channels of one engine, in their saved order; the name falls back to the id. */
export function providerEntries(
  engine: EngineId,
  section: Pick<EngineChannels, "channels"> | undefined,
): ProviderEntry[] {
  if (!section) return [];
  return section.channels.map(({ id, config: raw, hasKey }: ChannelView) => {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
      id,
      name: asString(o.name).trim() || id,
      remark: asString(o.remark),
      baseUrl: asString(o.baseUrl) || channelBaseUrl(engine, raw),
      model: providerModel(engine, raw),
      hasKey,
      raw,
    };
  });
}

/** The base URL a channel carries in its raw environment or Codex config, for the row. */
function channelBaseUrl(engine: EngineId, raw: unknown): string {
  const keys = ENV_CONVENTION_KEYS[engine];
  const env = channelEnv(raw);
  if (keys?.[0]) {
    const value = asString(env[keys[0]]).trim();
    if (value) return value;
  }
  if (engine === "codex")
    return /^\s*base_url\s*=\s*"([^"]*)"/m.exec(codexConfigToml(raw))?.[1] ?? "";
  return "";
}

/** Sent after any channel change, so model pickers that cache the channels read them again. */
const CLI_CONFIG_CHANGED_EVENT = "misty:engine-channels-changed";

export function notifyCliConfigChanged() {
  window.dispatchEvent(new Event(CLI_CONFIG_CHANGED_EVENT));
}
