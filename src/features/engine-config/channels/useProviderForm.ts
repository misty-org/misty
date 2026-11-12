// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { useState, type Dispatch, type SetStateAction } from "react";
import { channelsApi } from "./api";
import type { EngineId } from "./engines";
import {
  DEFAULT_CODEX_AUTH_JSON,
  OFFICIAL_BASE_URL,
  OFFICIAL_CODEX_BASE_URL,
  OFFICIAL_CODEX_CONFIG_TOML,
  PRESETS,
  authJsonApiKey,
  buildCodexConfigToml,
  claudeTemplateJson,
  findMatchedPreset,
  tomlBaseUrl,
  tomlModel,
  type ClaudeModelSlot,
  type ProviderPreset,
} from "./providerPresets";

/**
 * One channel in the add or edit dialog, per engine:
 *   - Claude Code: presets, then name, note, URL and key, then each tier's default model, then
 *     the settings.json editor. Fields and the JSON editor stay in sync both ways; the JSON is
 *     saved as the channel's settingsConfig.
 *   - Codex: presets, then name and note, then the config.toml and auth.json editors (saved as
 *     settingsConfig.config and settingsConfig.auth).
 *   - The rest: presets, then flat name, note, URL, key and model, with fetched models offered
 *     on the model field.
 *
 * A saved key never comes back to the window: on edit the key field starts empty, and leaving
 * it empty keeps the saved one.
 */
export interface ProviderFormValue {
  name: string;
  remark: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Claude Code: the whole settings.json text, stored as settingsConfig. */
  settingsJson: string;
  /** Codex: config.toml text, stored as settingsConfig.config. */
  configToml: string;
  /** Codex: auth.json text, stored as settingsConfig.auth. */
  authJson: string;
}

const strings = {
  jsonError: "Invalid JSON",
  authJsonError: "auth.json is not valid JSON",
  fetchNeedUrl: "Enter an API URL first",
  fetchEmpty: "No models returned",
  fetchError: "Couldn't fetch models",
};

const EMPTY_FORM: ProviderFormValue = {
  name: "",
  remark: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  settingsJson: "",
  configToml: "",
  authJson: "",
};

const EMPTY_SLOTS: Record<ClaudeModelSlot, string> = { fable: "", sonnet: "", opus: "", haiku: "" };

/** The form's first state per engine. Claude Code seeds the JSON editor from the stored
 *  settingsConfig (edit), the flat fields (older channels), or the official template (add);
 *  Codex seeds config.toml and auth.json the same way. */
function initialForm(engine: EngineId, initial?: ProviderFormValue): ProviderFormValue {
  const base: ProviderFormValue = { ...EMPTY_FORM, ...initial };
  if (engine === "claude") {
    if (base.settingsJson.trim()) return base;
    if (initial) {
      // A flat channel: move its fields into the default template.
      const extra: Record<string, string> = {};
      if (base.model.trim()) extra.ANTHROPIC_MODEL = base.model.trim();
      return {
        ...base,
        settingsJson: claudeTemplateJson(base.baseUrl.trim(), base.apiKey.trim(), extra),
      };
    }
    // A new channel starts on the official endpoint.
    return {
      ...base,
      baseUrl: OFFICIAL_BASE_URL,
      settingsJson: claudeTemplateJson(OFFICIAL_BASE_URL, ""),
    };
  }
  if (engine === "codex") {
    return {
      ...base,
      configToml: base.configToml.trim()
        ? base.configToml
        : initial
          ? buildCodexConfigToml(
              "misty",
              base.baseUrl.trim() || "https://api.example.com/v1",
              base.model.trim() || "gpt-5.1-codex",
              "chat",
            )
          : OFFICIAL_CODEX_CONFIG_TOML,
      authJson: base.authJson.trim() ? base.authJson : DEFAULT_CODEX_AUTH_JSON,
    };
  }
  return base;
}

/** Claude model-slot values parsed out of a settings.json text. */
function slotsFromJson(settingsJson: string): Record<ClaudeModelSlot, string> {
  try {
    const parsed: unknown = JSON.parse(settingsJson);
    const env = (parsed as Record<string, unknown> | null)?.env;
    if (!env || typeof env !== "object") return { ...EMPTY_SLOTS };
    const read = (key: string) => {
      const v = (env as Record<string, unknown>)[key];
      return typeof v === "string" ? v : "";
    };
    return {
      fable: read("ANTHROPIC_DEFAULT_FABLE_MODEL"),
      sonnet: read("ANTHROPIC_DEFAULT_SONNET_MODEL"),
      opus: read("ANTHROPIC_DEFAULT_OPUS_MODEL"),
      haiku: read("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    };
  } catch {
    return { ...EMPTY_SLOTS };
  }
}

/**
 * State and changes for the channel dialog: the flat value, Claude Code's tier models mirrored
 * into the JSON editor both ways, presets, fetching models, and each engine's validity and save.
 * `channelId` is the saved channel being edited, so fetching models can use its saved key in
 * native code.
 */
export function useProviderForm({
  engine,
  initial,
  channelId,
  onSubmit,
}: {
  engine: EngineId;
  initial?: ProviderFormValue;
  channelId?: string;
  onSubmit: (value: ProviderFormValue) => void;
}): ProviderForm {
  const isClaude = engine === "claude";
  const isCodex = engine === "codex";
  const [value, setValue] = useState<ProviderFormValue>(() => initialForm(engine, initial));
  // Tier models start empty on add (the template's env carries the defaults); on edit they
  // mirror the stored settings.json.
  const [slots, setSlots] = useState<Record<ClaudeModelSlot, string>>(() =>
    isClaude && initial?.settingsJson ? slotsFromJson(initial.settingsJson) : { ...EMPTY_SLOTS },
  );
  const [jsonError, setJsonError] = useState("");
  const [authError, setAuthError] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const presets = PRESETS[engine] ?? [];
  const patch = (p: Partial<ProviderFormValue>) => setValue((v) => ({ ...v, ...p }));

  // ── Claude Code JSON and field sync ───────────────────────────────────────

  /** Writes one variable into the JSON editor's text. Text the person broke (invalid JSON) is
   *  left alone; the editor already shows the error. */
  const updateClaudeEnv = (key: string, val: string) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = value.settingsJson
        ? (JSON.parse(value.settingsJson) as Record<string, unknown>)
        : {};
    } catch {
      return;
    }
    const prevEnv = (parsed.env ?? {}) as Record<string, unknown>;
    const nextEnv = { ...prevEnv };
    if (val.trim()) nextEnv[key] = val;
    else delete nextEnv[key];
    const next =
      Object.keys(nextEnv).length > 0
        ? { ...parsed, env: nextEnv }
        : Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== "env"));
    patch({ settingsJson: JSON.stringify(next, null, 2) });
    setJsonError("");
  };

  const onJsonChange = (text: string) => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const env = (parsed.env ?? {}) as Record<string, unknown>;
      const read = (key: string) => {
        const v = env[key];
        return typeof v === "string" ? v : "";
      };
      setSlots({
        fable: read("ANTHROPIC_DEFAULT_FABLE_MODEL"),
        sonnet: read("ANTHROPIC_DEFAULT_SONNET_MODEL"),
        opus: read("ANTHROPIC_DEFAULT_OPUS_MODEL"),
        haiku: read("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
      });
      setValue((v) => ({
        ...v,
        settingsJson: text,
        baseUrl: read("ANTHROPIC_BASE_URL"),
        apiKey: read("ANTHROPIC_AUTH_TOKEN") || read("ANTHROPIC_API_KEY"),
      }));
      setJsonError("");
    } catch {
      setValue((v) => ({ ...v, settingsJson: text }));
      setJsonError(strings.jsonError);
    }
  };

  const handleFormatJson = () => {
    try {
      patch({ settingsJson: JSON.stringify(JSON.parse(value.settingsJson), null, 2) });
      setJsonError("");
    } catch {
      setJsonError(strings.jsonError);
    }
  };

  const handleFormatAuthJson = () => {
    try {
      patch({ authJson: JSON.stringify(JSON.parse(value.authJson), null, 2) });
      setAuthError("");
    } catch {
      setAuthError(strings.authJsonError);
    }
  };

  // ── presets ───────────────────────────────────────────────────────────────

  const selectPreset = (preset: ProviderPreset) => {
    if (isClaude) {
      const slotEnv = preset.env ?? {};
      setSlots({
        fable: slotEnv.ANTHROPIC_DEFAULT_FABLE_MODEL ?? "",
        sonnet: slotEnv.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "",
        opus: slotEnv.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "",
        haiku: slotEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "",
      });
      setValue((v) => ({
        ...v,
        name: preset.name,
        baseUrl: preset.baseUrl,
        settingsJson: claudeTemplateJson(preset.baseUrl, v.apiKey.trim(), slotEnv),
      }));
      setJsonError("");
    } else if (isCodex) {
      setValue((v) => ({
        ...v,
        name: preset.name,
        configToml: buildCodexConfigToml(
          preset.name,
          preset.baseUrl,
          preset.model || "gpt-5.1-codex",
          preset.wireApi ?? "chat",
        ),
      }));
    } else {
      setValue((v) => ({ ...v, name: preset.name, baseUrl: preset.baseUrl, model: preset.model }));
    }
    resetFetch();
  };

  const selectOfficial = () => {
    if (isClaude) {
      setSlots({ ...EMPTY_SLOTS });
      setValue((v) => ({
        ...v,
        baseUrl: OFFICIAL_BASE_URL,
        settingsJson: claudeTemplateJson(OFFICIAL_BASE_URL, v.apiKey.trim()),
      }));
      setJsonError("");
    } else if (isCodex) {
      patch({ configToml: OFFICIAL_CODEX_CONFIG_TOML });
    }
    resetFetch();
  };

  const selectCustom = () => {
    if (isClaude) {
      setSlots({ ...EMPTY_SLOTS });
      setValue((v) => ({
        ...v,
        baseUrl: "",
        settingsJson: claudeTemplateJson("", v.apiKey.trim()),
      }));
      setJsonError("");
    } else if (isCodex) {
      patch({
        configToml: buildCodexConfigToml(
          "custom",
          "https://api.example.com/v1",
          "gpt-5.1-codex",
          "responses",
        ),
      });
    } else {
      patch({ baseUrl: "" });
    }
    resetFetch();
  };

  // ── fetch models ──────────────────────────────────────────────────────────

  function resetFetch() {
    setFetchedModels([]);
    setFetchError("");
  }

  const handleFetchModels = async () => {
    const baseUrl = isCodex ? tomlBaseUrl(value.configToml) : value.baseUrl.trim();
    const apiKey = isCodex ? authJsonApiKey(value.authJson) : value.apiKey;
    if (!baseUrl) {
      setFetchError(strings.fetchNeedUrl);
      return;
    }
    setFetching(true);
    setFetchError("");
    try {
      // Without a typed key, native code uses the saved channel's own key.
      const result = await channelsApi.models(engine, {
        id: channelId,
        baseUrl,
        apiKey: apiKey.trim() || undefined,
      });
      setFetchedModels(result.models);
      if (result.models.length === 0) setFetchError(strings.fetchEmpty);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setFetchError(message || strings.fetchError);
    } finally {
      setFetching(false);
    }
  };

  // ── validity & submit ─────────────────────────────────────────────────────

  const official = isClaude
    ? value.baseUrl === OFFICIAL_BASE_URL
    : isCodex
      ? tomlBaseUrl(value.configToml) === OFFICIAL_CODEX_BASE_URL
      : false;
  const matchedPreset = findMatchedPreset(
    presets,
    isCodex ? tomlBaseUrl(value.configToml) : value.baseUrl,
  );

  const jsonValid = (() => {
    if (!isClaude) return true;
    try {
      JSON.parse(value.settingsJson || "{}");
      return true;
    } catch {
      return false;
    }
  })();
  const authValid = (() => {
    if (!isCodex || !value.authJson.trim()) return true;
    try {
      JSON.parse(value.authJson);
      return true;
    } catch {
      return false;
    }
  })();
  const valid =
    value.name.trim() !== "" &&
    (isCodex ? value.configToml.trim() !== "" : value.baseUrl.trim() !== "") &&
    jsonValid &&
    authValid;

  const submit = () => {
    if (!valid) return;
    if (isCodex) {
      // Flat copies for the row and the model picker; native code applies the TOML and
      // auth.json themselves.
      onSubmit({
        ...value,
        baseUrl: tomlBaseUrl(value.configToml),
        apiKey: authJsonApiKey(value.authJson),
        model: tomlModel(value.configToml),
      });
      return;
    }
    onSubmit(value);
  };

  return {
    value,
    patch,
    slots,
    setSlots,
    jsonError,
    authError,
    setAuthError,
    fetchedModels,
    fetching,
    fetchError,
    presets,
    official,
    matchedPreset,
    jsonValid,
    authValid,
    valid,
    updateClaudeEnv,
    onJsonChange,
    handleFormatJson,
    handleFormatAuthJson,
    selectPreset,
    selectOfficial,
    selectCustom,
    handleFetchModels,
    submit,
  };
}

/** What useProviderForm returns; the section components take it as one `form` prop. */
export interface ProviderForm {
  value: ProviderFormValue;
  patch: (p: Partial<ProviderFormValue>) => void;
  slots: Record<ClaudeModelSlot, string>;
  setSlots: Dispatch<SetStateAction<Record<ClaudeModelSlot, string>>>;
  jsonError: string;
  authError: string;
  setAuthError: Dispatch<SetStateAction<string>>;
  fetchedModels: string[];
  fetching: boolean;
  fetchError: string;
  presets: ProviderPreset[];
  official: boolean;
  matchedPreset: ProviderPreset | undefined;
  jsonValid: boolean;
  authValid: boolean;
  valid: boolean;
  updateClaudeEnv: (key: string, val: string) => void;
  onJsonChange: (text: string) => void;
  handleFormatJson: () => void;
  handleFormatAuthJson: () => void;
  selectPreset: (preset: ProviderPreset) => void;
  selectOfficial: () => void;
  selectCustom: () => void;
  handleFetchModels: () => Promise<void>;
  submit: () => void;
}
