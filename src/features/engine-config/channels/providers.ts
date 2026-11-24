// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import type { ChannelView, EngineChannels } from "./api";
import type { EngineId } from "./engines";

export const PSEUDO_LOCAL = "__local_settings_json__";
export const PSEUDO_DISABLED = "__disabled__";

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

function channelEnv(raw: unknown): Record<string, unknown> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flat = o.env && typeof o.env === "object" ? (o.env as Record<string, unknown>) : {};
  const settings = (o.settingsConfig as Record<string, unknown> | undefined)?.env;
  const nested =
    settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  return { ...flat, ...nested };
}

const ENV_MODEL_KEY: Partial<Record<EngineId, string>> = {
  claude: "ANTHROPIC_MODEL",
};

function providerModel(engine: EngineId, raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flat = asString(o.model).trim();
  if (flat) return flat;
  const key = ENV_MODEL_KEY[engine];
  if (!key) return "";
  return asString(channelEnv(raw)[key]).trim();
}

const ENV_CONVENTION_KEYS: Partial<Record<EngineId, string[]>> = {
  claude: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"],
  codex: ["OPENAI_BASE_URL", "OPENAI_API_KEY"],
};

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

export function codexConfigToml(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig as Record<string, unknown> | undefined;
  return asString(sc?.config);
}

export function codexAuthJson(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig as Record<string, unknown> | undefined;
  const auth = sc?.auth;
  if (auth && typeof auth === "object" && Object.keys(auth).length > 0) {
    return JSON.stringify(auth, null, 2);
  }
  return "";
}

export interface ProviderEntry {
  id: string;
  name: string;
  remark: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  raw: unknown;
}

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

const CLI_CONFIG_CHANGED_EVENT = "misty:engine-channels-changed";

export function notifyCliConfigChanged() {
  window.dispatchEvent(new Event(CLI_CONFIG_CHANGED_EVENT));
}
