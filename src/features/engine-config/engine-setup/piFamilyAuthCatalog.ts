// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): piFamilyAuthCatalog.ts.
// See NOTICE.

/**
 * Pi's and Oh My Pi's providers for Settings › Channels.
 *
 * - `id` matches the native catalog (`engines/pi_family_auth.rs`): Pi's auth.json entry key, Oh My
 *   Pi's `auth_credentials.provider`.
 * - Marks come from @lobehub/icons-static-svg (brands/brandMarks.json); a provider without a
 *   public mark shows a globe, never a letter tile dressed up as a brand.
 * - `featured` ones show at first; the rest fold under "Show all".
 *
 * Sign-in differs per engine: Pi's `/login <arg>` takes Pi's provider ids, Oh My Pi's
 * `omp auth-broker login <id>` its own longer list. `statusIds` name the credential-store ids that
 * count as signed in for the row (Pi keeps a ChatGPT sign-in as `openai-codex`).
 */
import type { BrandMarkId } from "../brands/BrandMark";

export interface PiFamilyAuthUiProvider {
  /** Credential-store entry key (backend catalog id). */
  id: string;
  /** Brand display name (not translated). */
  name: string;
  /** The provider's mark (brands/brandMarks.json); null shows a globe. */
  mark: BrandMarkId | null;
  /** Shown by default (true) or folded into "show all" (false). */
  featured: boolean;
}

/** API Key group: 36 entries (github-copilot is OAuth-only and not listed;
 * the moonshotai dual-region pair follows pi 0.84.x's env map). */
export const PI_FAMILY_APIKEY_PROVIDERS: readonly PiFamilyAuthUiProvider[] = [
  { id: "anthropic", name: "Anthropic", mark: "anthropic", featured: true },
  { id: "openai", name: "OpenAI", mark: "openai", featured: true },
  { id: "google", name: "Google Gemini", mark: "gemini-color", featured: true },
  { id: "deepseek", name: "DeepSeek", mark: "deepseek-color", featured: true },
  { id: "xai", name: "xAI", mark: "xai", featured: true },
  { id: "openrouter", name: "OpenRouter", mark: "openrouter-color", featured: true },
  { id: "groq", name: "Groq", mark: "groq", featured: true },
  { id: "mistral", name: "Mistral", mark: "mistral-color", featured: true },
  { id: "zai", name: "ZAI Coding Plan", mark: "zhipu-color", featured: true },
  { id: "kimi-coding", name: "Kimi For Coding", mark: "kimi-color", featured: true },
  { id: "moonshotai", name: "Moonshot AI", mark: "moonshot", featured: false },
  { id: "moonshotai-cn", name: "Moonshot AI (China)", mark: "moonshot", featured: false },
  { id: "qwen-token-plan", name: "Qwen Token Plan", mark: "qwen-color", featured: true },
  { id: "minimax", name: "MiniMax", mark: "minimax-color", featured: true },
  { id: "together", name: "Together AI", mark: "together-color", featured: true },
  { id: "fireworks", name: "Fireworks", mark: "fireworks-color", featured: true },
  { id: "cerebras", name: "Cerebras", mark: "cerebras-color", featured: true },
  { id: "amazon-bedrock", name: "Amazon Bedrock", mark: "bedrock-color", featured: true },
  { id: "ant-ling", name: "Ant Ling", mark: "ling-color", featured: false },
  {
    id: "azure-openai-responses",
    name: "Azure OpenAI Responses",
    mark: "azureai-color",
    featured: false,
  },
  { id: "nvidia", name: "NVIDIA NIM", mark: "nvidia-color", featured: false },
  {
    id: "cloudflare-ai-gateway",
    name: "Cloudflare AI Gateway",
    mark: "cloudflare-color",
    featured: false,
  },
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    mark: "cloudflare-color",
    featured: false,
  },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", mark: "vercel", featured: false },
  { id: "zai-coding-cn", name: "ZAI Coding Plan (China)", mark: "zhipu-color", featured: false },
  { id: "opencode", name: "OpenCode Zen", mark: "opencode", featured: false },
  { id: "opencode-go", name: "OpenCode Go", mark: "opencode", featured: false },
  { id: "radius", name: "Radius", mark: null, featured: false },
  { id: "huggingface", name: "Hugging Face", mark: "huggingface-color", featured: false },
  { id: "baseten", name: "Baseten", mark: "baseten", featured: false },
  { id: "minimax-cn", name: "MiniMax (China)", mark: "minimax-color", featured: false },
  {
    id: "qwen-token-plan-individual",
    name: "Qwen Token Plan (Individual)",
    mark: "qwen-color",
    featured: false,
  },
  {
    id: "qwen-token-plan-cn",
    name: "Qwen Token Plan (China)",
    mark: "qwen-color",
    featured: false,
  },
  { id: "xiaomi", name: "Xiaomi MiMo", mark: "xiaomimimo", featured: false },
  {
    id: "xiaomi-token-plan-cn",
    name: "Xiaomi MiMo Token Plan (China)",
    mark: "xiaomimimo",
    featured: false,
  },
  {
    id: "xiaomi-token-plan-ams",
    name: "Xiaomi MiMo Token Plan (Amsterdam)",
    mark: "xiaomimimo",
    featured: false,
  },
  {
    id: "xiaomi-token-plan-sgp",
    name: "Xiaomi MiMo Token Plan (Singapore)",
    mark: "xiaomimimo",
    featured: false,
  },
];

export interface PiFamilyOauthProvider {
  id: string;
  name: string;
  mark: BrandMarkId | null;
  /** pi: `/login <loginArg>`; omp: `omp auth-broker login <loginArg>`. */
  loginArg: string;
  /** Credential-store ids that mean "authorized" for this row. */
  statusIds: readonly string[];
  /** What the subscription is. */
  detail: string;
}

const PI_OAUTH_PROVIDERS: readonly PiFamilyOauthProvider[] = [
  {
    id: "anthropic",
    name: "Claude Pro / Max",
    mark: "claude-color",
    loginArg: "anthropic",
    statusIds: ["anthropic"],
    detail: "Claude Pro / Max subscription",
  },
  {
    id: "openai",
    name: "ChatGPT Plus / Pro (Codex)",
    mark: "openai",
    loginArg: "openai",
    statusIds: ["openai", "openai-codex"],
    detail: "ChatGPT Plus / Pro subscription",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    mark: "copilot-color",
    loginArg: "github-copilot",
    statusIds: ["github-copilot"],
    detail: "GitHub Copilot subscription",
  },
  {
    id: "xai",
    name: "xAI (Grok / X)",
    mark: "xai",
    loginArg: "xai",
    statusIds: ["xai"],
    detail: "SuperGrok / X Premium+ subscription",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    mark: "openrouter-color",
    loginArg: "openrouter",
    statusIds: ["openrouter"],
    detail: "OpenRouter account",
  },
  {
    id: "radius",
    name: "Radius",
    mark: null,
    loginArg: "radius",
    statusIds: ["radius"],
    detail: "Radius account",
  },
];

/** omp's OAuth providers (`omp auth-broker list`); login is a plain CLI
 * command, not a TUI slash command. */
const OMP_OAUTH_PROVIDERS: readonly PiFamilyOauthProvider[] = [
  {
    id: "anthropic",
    name: "Claude Pro / Max",
    mark: "claude-color",
    loginArg: "anthropic",
    statusIds: ["anthropic"],
    detail: "Claude Pro / Max subscription",
  },
  {
    id: "openai-codex",
    name: "ChatGPT Plus / Pro (Codex)",
    mark: "openai",
    loginArg: "openai-codex",
    statusIds: ["openai-codex"],
    detail: "ChatGPT Plus / Pro subscription",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    mark: "copilot-color",
    loginArg: "github-copilot",
    statusIds: ["github-copilot"],
    detail: "GitHub Copilot subscription",
  },
  {
    id: "xai-oauth",
    name: "xAI (Grok / X)",
    mark: "xai",
    loginArg: "xai-oauth",
    statusIds: ["xai-oauth", "xai"],
    detail: "SuperGrok / X Premium+ subscription",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    mark: "openrouter-color",
    loginArg: "openrouter",
    statusIds: ["openrouter"],
    detail: "OpenRouter account",
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    mark: "kimi-color",
    loginArg: "kimi-code",
    statusIds: ["kimi-code"],
    detail: "Kimi Code subscription",
  },
  {
    id: "zai",
    name: "Z.AI (GLM Coding Plan)",
    mark: "zhipu-color",
    loginArg: "zai",
    statusIds: ["zai", "zai-coding-plan"],
    detail: "Z.AI GLM Coding Plan subscription",
  },
  {
    id: "google-antigravity",
    name: "Google Antigravity",
    mark: "gemini-color",
    loginArg: "google-antigravity",
    statusIds: ["google-antigravity"],
    detail: "Google Antigravity (Gemini 3 / Claude)",
  },
  {
    id: "google-gemini-cli",
    name: "Google Code Assist (Gemini CLI)",
    mark: "gemini-color",
    loginArg: "google-gemini-cli",
    statusIds: ["google-gemini-cli"],
    detail: "Google Code Assist",
  },
];

export const PI_FAMILY_OAUTH_PROVIDERS: Record<"pi" | "omp", readonly PiFamilyOauthProvider[]> = {
  pi: PI_OAUTH_PROVIDERS,
  omp: OMP_OAUTH_PROVIDERS,
};
