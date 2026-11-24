// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

export const ENGINE_IDS = ["claude", "codex", "agy"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const ENGINE_NAMES: Record<EngineId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  agy: "Antigravity",
};

export const ENGINE_DOCS_URLS: Record<EngineId, string> = {
  claude: "https://code.claude.com/docs/en/cli-reference",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  agy: "https://www.antigravity.google/docs/cli/headless/",
};

export const CC_SWITCH_ENGINES: readonly EngineId[] = ["claude", "codex"];

export const OFFICIAL_EDITABLE_ENGINES: readonly EngineId[] = ["claude", "codex", "agy"];

export const engineName = (id: string): string => ENGINE_NAMES[id as EngineId] ?? id;
