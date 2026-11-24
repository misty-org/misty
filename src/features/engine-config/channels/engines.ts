// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

export const ENGINE_IDS = [
  "claude",
  "codex",
  "gemini",
  "qwen",
  "kimi",
  "grok",
  "minimax",
  "qoder",
  "qoder-cn",
  "agy",
  "hermes",
] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_NAMES: Record<EngineId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  qwen: "Qwen Code",
  kimi: "Kimi CLI",
  grok: "Grok CLI",
  minimax: "MiniMax Code",
  qoder: "Qoder CLI",
  "qoder-cn": "Qoder CLI (China)",
  agy: "Antigravity",
  hermes: "Hermes Agent",
};

export const ENGINE_DOCS_URLS: Record<EngineId, string> = {
  claude: "https://code.claude.com/docs/en/cli-reference",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  gemini: "https://github.com/google-gemini/gemini-cli",
  qwen: "https://github.com/QwenLM/qwen-code",
  kimi: "https://www.kimi.com/code/docs/en/",
  grok: "https://x.ai/cli",
  minimax: "https://agent.minimax.cn/docs/cli/quick-start",
  qoder: "https://docs.qoder.com/en/cli/using-cli",
  "qoder-cn": "https://docs.qoder.com/zh/cli/using-cli",
  agy: "https://www.antigravity.google/docs/cli/headless/",
  hermes: "https://hermes-agent.nousresearch.com/docs/",
};

export const CC_SWITCH_ENGINES: readonly EngineId[] = ["claude", "codex", "grok"];

export const OFFICIAL_EDITABLE_ENGINES: readonly EngineId[] = [
  "claude",
  "codex",
  "kimi",
  "grok",
  "agy",
];

export const engineName = (id: string): string => ENGINE_NAMES[id as EngineId] ?? id;
