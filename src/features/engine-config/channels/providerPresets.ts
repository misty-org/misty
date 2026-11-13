// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/** Preset tables and config templates for the channel dialog. */

import type { BrandMarkId } from "../brands/BrandMark";
import type { EngineId } from "./engines";

export interface ProviderPreset {
  /** The provider's own name. */
  name: string;
  /** The provider's own mark (brands/brandMarks.json); none where it has no public one. */
  mark?: BrandMarkId;
  baseUrl: string;
  model: string;
  /** Claude Code: extra env merged into the JSON config on preset pick —
   *  ANTHROPIC_DEFAULT_<TIER>_MODEL slots plus per-provider tuning vars. */
  env?: Record<string, string>;
  /** Codex: wire_api for the generated config.toml (default "chat" — the
   *  relays below are chat-completions compatible). */
  wireApi?: "responses" | "chat";
}

/** Claude Code only: the official endpoint. Choosing the official card locks the API URL to it. */
export const OFFICIAL_BASE_URL = "https://api.anthropic.com";
export const OFFICIAL_CODEX_BASE_URL = "https://api.openai.com/v1";

/** Model-slot env keys, in the grid's display order. */
export const CLAUDE_MODEL_SLOTS = [
  { slot: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  { slot: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { slot: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { slot: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
] as const;
export type ClaudeModelSlot = (typeof CLAUDE_MODEL_SLOTS)[number]["slot"];

/** The default settings.json template for a new Claude Code channel. A start passes only its
 *  `model`, `alwaysThinkingEnabled` and `env` to the CLI; the rest is kept for the person's own
 *  reference and for CC Switch round trips. */
function buildDefaultClaudeSettings(): Record<string, unknown> & {
  env: Record<string, string>;
} {
  return {
    alwaysThinkingEnabled: true,
    autoDreamEnabled: true,
    cleanupPeriodDays: 720,
    effortLevel: "xhigh",
    env: {
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "",
      ANTHROPIC_BETAS: "context-1m-2025-08-07",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
      ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_CODE_NEW_INIT: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_TELEMETRY: "1",
      ENABLE_TOOL_SEARCH: "1",
      MAX_THINKING_TOKENS: "31999",
      MCP_TIMEOUT: "60000",
    },
    hasCompletedOnboarding: true,
    model: "opus",
    skipAutoPermissionPrompt: true,
    teammateMode: "in-process",
    tui: "fullscreen",
  };
}

/** Fresh settings.json text for a claude channel: the default template with
 *  the endpoint, the user's token and any preset env merged in. */
export function claudeTemplateJson(
  baseUrl: string,
  apiKey: string,
  extraEnv: Record<string, string> = {},
): string {
  const config = buildDefaultClaudeSettings();
  config.env.ANTHROPIC_BASE_URL = baseUrl;
  config.env.ANTHROPIC_AUTH_TOKEN = apiKey;
  for (const [key, val] of Object.entries(extraEnv)) {
    config.env[key] = val;
  }
  return JSON.stringify(config, null, 2);
}

// ── codex config.toml ───────────────────────────────────────────────────────

const tomlString = (value: string): string => JSON.stringify(value);

/** A Codex config.toml with one model_providers table. */
export function buildCodexConfigToml(
  providerName: string,
  baseUrl: string,
  model: string,
  wireApi: "responses" | "chat" = "responses",
  providerId = "custom",
): string {
  return `model = ${tomlString(model)}
model_reasoning_effort = "high"
model_provider = ${tomlString(providerId)}

[model_providers.${providerId}]
base_url = ${tomlString(baseUrl)}
name = ${tomlString(providerName)}
requires_openai_auth = true
wire_api = ${tomlString(wireApi)}`;
}

export const DEFAULT_CODEX_AUTH_JSON = `{
  "OPENAI_API_KEY": ""
}`;

export const OFFICIAL_CODEX_CONFIG_TOML = buildCodexConfigToml(
  "openai",
  OFFICIAL_CODEX_BASE_URL,
  "gpt-5.1-codex",
  "responses",
  "openai",
);

/** The first `base_url = "…"` in a config.toml, for display and preset matching; native code
 *  applies the TOML itself. */
export function tomlBaseUrl(toml: string): string {
  return toml.match(/^\s*base_url\s*=\s*"([^"]*)"/m)?.[1] ?? "";
}

/** Top-level `model = "…"`. */
export function tomlModel(toml: string): string {
  return toml.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? "";
}

/** OPENAI_API_KEY out of an auth.json text; "" when unparseable/absent. */
export function authJsonApiKey(authJson: string): string {
  try {
    const parsed: unknown = JSON.parse(authJson);
    if (parsed && typeof parsed === "object") {
      const key = (parsed as Record<string, unknown>).OPENAI_API_KEY;
      return typeof key === "string" ? key : "";
    }
  } catch {
    // Invalid JSON: the dialog says so separately.
  }
  return "";
}

// ── preset tables ───────────────────────────────────────────────────────────

/** Third-party presets per engine. Claude Code's carry each tier's model; Codex's carry the
 *  wire_api of the generated config.toml. */
export const PRESETS: Partial<Record<EngineId, ProviderPreset[]>> = {
  claude: [
    {
      name: "API Route",
      baseUrl: "https://global.api-route.com",
      model: "claude-fable-5-1",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "claude-fable-5-1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
      },
    },
    {
      name: "Zhipu GLM",
      mark: "zhipu-color",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      model: "glm-5.2",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2",
      },
    },
    {
      name: "Kimi",
      mark: "kimi",
      baseUrl: "https://api.moonshot.cn/anthropic",
      model: "kimi-k3",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k3",
      },
    },
    {
      name: "Kimi Coding",
      mark: "kimi",
      baseUrl: "https://api.kimi.com/coding/",
      model: "kimi-k3",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k3",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "262144",
      },
    },
    {
      name: "DeepSeek",
      mark: "deepseek-color",
      baseUrl: "https://api.deepseek.com/anthropic",
      model: "deepseek-v4-pro[1m]",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "deepseek-v4-pro[1m]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro[1m]",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
      },
    },
    {
      name: "MiniMax",
      mark: "minimax-color",
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M2.1",
      env: {
        // MiniMax answers slowly: a 50-minute (3,000,000 ms) timeout keeps long reasoning whole.
        API_TIMEOUT_MS: "3000000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ANTHROPIC_DEFAULT_FABLE_MODEL: "MiniMax-M2.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.1",
      },
    },
    {
      name: "Xiaomi MiMo",
      mark: "xiaomimimo",
      baseUrl: "https://api.xiaomimimo.com/anthropic",
      model: "mimo-v2.5-pro",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
      },
    },
    {
      name: "Xiaomi MiMo Plan",
      mark: "xiaomimimo",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
      model: "mimo-v2.5-pro",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
      },
    },
    {
      name: "Bailian",
      mark: "bailian-color",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      model: "",
    },
    {
      name: "Bailian Coding",
      mark: "bailian-color",
      baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
      model: "",
    },
    {
      name: "LongCat",
      mark: "longcat-color",
      baseUrl: "https://api.longcat.chat/anthropic",
      model: "LongCat-2.0",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "LongCat-2.0",
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "131072",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
    {
      name: "OpenCode Go",
      mark: "opencode",
      baseUrl: "https://opencode.ai/zen/go",
      model: "deepseek-v4-flash",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-flash",
      },
    },
    {
      name: "OpenRouter",
      mark: "openrouter-color",
      baseUrl: "https://openrouter.ai/api",
      model: "anthropic/claude-sonnet-4.5",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "anthropic/claude-fable-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.5",
      },
    },
    {
      name: "Requesty",
      baseUrl: "https://router.requesty.ai",
      model: "anthropic/claude-sonnet-4-5",
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "anthropic/claude-fable-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4-5",
      },
    },
  ],
  kimi: [
    {
      name: "Kimi Coding",
      mark: "kimi",
      baseUrl: "https://api.kimi.com/coding/v1",
      model: "kimi-for-coding",
    },
    { name: "Moonshot", mark: "moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "" },
  ],
  grok: [
    { name: "xAI Official", mark: "xai", baseUrl: "https://api.x.ai/v1", model: "grok-build" },
  ],
  codex: [
    {
      name: "API Route",
      baseUrl: "https://global.api-route.com/v1",
      model: "gpt-6.1-sol",
      wireApi: "responses",
    },
    {
      name: "Zhipu GLM",
      mark: "zhipu-color",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      model: "glm-5.2",
      wireApi: "chat",
    },
    {
      name: "Kimi",
      mark: "kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k3",
      wireApi: "chat",
    },
    {
      name: "Kimi Coding",
      mark: "kimi",
      baseUrl: "https://api.kimi.com/coding/v1",
      model: "kimi-k3",
      wireApi: "chat",
    },
    {
      name: "DeepSeek",
      mark: "deepseek-color",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      wireApi: "chat",
    },
    {
      name: "MiniMax",
      mark: "minimax-color",
      baseUrl: "https://api.minimaxi.com/v1",
      model: "MiniMax-M3",
      wireApi: "chat",
    },
    {
      name: "Xiaomi MiMo",
      mark: "xiaomimimo",
      baseUrl: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5-pro",
      wireApi: "chat",
    },
    {
      name: "Bailian Coding",
      mark: "bailian-color",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      model: "qwen3-coder-plus",
      wireApi: "chat",
    },
    {
      name: "LongCat",
      mark: "longcat-color",
      baseUrl: "https://api.longcat.chat/openai/v1",
      model: "LongCat-2.0",
      wireApi: "chat",
    },
    {
      name: "OpenCode Go",
      mark: "opencode",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "glm-5.2",
      wireApi: "chat",
    },
    {
      name: "OpenRouter",
      mark: "openrouter-color",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "",
      wireApi: "chat",
    },
    { name: "Requesty", baseUrl: "https://router.requesty.ai/v1", model: "", wireApi: "chat" },
  ],
};

/** The preset matching the current URL; the empty custom URL matches nothing. */
export function findMatchedPreset(
  presets: ProviderPreset[],
  baseUrl: string,
): ProviderPreset | undefined {
  return presets.find((p) => p.baseUrl === baseUrl && p.baseUrl !== "");
}

/** Empty and api.anthropic.com (any scheme or path) count as the official endpoint. */
export function isOfficialAnthropicEndpoint(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase();
  if (normalized === "") return true;
  try {
    return new URL(normalized).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}
