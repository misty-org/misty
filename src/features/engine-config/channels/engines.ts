// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/** The engines a provider channel or a CLI lifecycle can be set for, in Settings order. */
export const ENGINE_IDS = [
  "claude",
  "codex",
  "opencode",
  "gemini",
  "qwen",
  "kimi",
  "grok",
  "minimax",
  "qoder",
  "qoder-cn",
  "omp",
  "codebuddy",
  "agy",
  "pi",
  "dsh",
  "hermes",
] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_NAMES: Record<EngineId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  qwen: "Qwen Code",
  kimi: "Kimi CLI",
  grok: "Grok CLI",
  minimax: "MiniMax Code",
  qoder: "Qoder CLI",
  "qoder-cn": "Qoder CLI (China)",
  omp: "Oh My Pi",
  codebuddy: "CodeBuddy",
  agy: "Antigravity",
  pi: "Pi",
  dsh: "DeepSeek Harness",
  hermes: "Hermes Agent",
};

/** Each engine's official documentation. */
export const ENGINE_DOCS_URLS: Record<EngineId, string> = {
  claude: "https://code.claude.com/docs/en/cli-reference",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  opencode: "https://opencode.ai/docs/",
  gemini: "https://github.com/google-gemini/gemini-cli",
  qwen: "https://github.com/QwenLM/qwen-code",
  kimi: "https://www.kimi.com/code/docs/en/",
  grok: "https://x.ai/cli",
  minimax: "https://agent.minimax.cn/docs/cli/quick-start",
  qoder: "https://docs.qoder.com/en/cli/using-cli",
  "qoder-cn": "https://docs.qoder.com/zh/cli/using-cli",
  omp: "https://omp.sh",
  codebuddy: "https://copilot.tencent.com/",
  agy: "https://www.antigravity.google/docs/cli/headless/",
  pi: "https://pi.dev/docs/latest/usage",
  dsh: "https://github.com/deepseek-ai/dsh",
  hermes: "https://hermes-agent.nousresearch.com/docs/",
};

/** Engines whose channels can come from CC Switch. */
export const CC_SWITCH_ENGINES: readonly EngineId[] = ["claude", "codex", "grok"];

/** Engines whose own config files the official editor can open. */
export const OFFICIAL_EDITABLE_ENGINES: readonly EngineId[] = [
  "claude",
  "codex",
  "kimi",
  "grok",
  "codebuddy",
  "agy",
];

export const engineName = (id: string): string => ENGINE_NAMES[id as EngineId] ?? id;
