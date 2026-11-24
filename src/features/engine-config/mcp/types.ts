// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

export type McpEngineId =
  | "claude"
  | "gemini"
  | "qwen"
  | "minimax"
  | "codex"
  | "kimi"
  | "grok"
  | "agy"
  | "qoder"
  | "qoder-cn";

export type McpConfigSource =
  | "claude_user"
  | "claude_local"
  | "claude_project"
  | "codex_user"
  | "codex_project"
  | "kimi_user"
  | "kimi_local"
  | "kimi_project"
  | "grok_user"
  | "grok_project"
  | "agy_user"
  | "agy_project"
  | "qoder_user"
  | "qoder_local"
  | "qoder_project"
  | "qoder_cn_user"
  | "qoder_cn_local"
  | "qoder_cn_project";

export type McpEngineSupport = "native" | "plugin" | "none";

export interface McpSourceInfo {
  source: McpConfigSource;
  path: string;
  exists: boolean;
}

export interface McpConfigEntry {
  id: string;
  engine: McpEngineId;
  name: string;
  source: McpConfigSource;
  scope: "user" | "project";
  workspaceFile: boolean;
  path: string;
  format: "json" | "toml" | "yaml";
  enabled: boolean;
  transport: string | null;
  command: string | null;
  argsCount: number;
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
  writable: boolean;
  readonlyReason: string | null;
  readonlyReasonCode?: string | null;
  version: string;
}

interface McpSourceError {
  source: string;
  path: string;
  message: string;
}

export interface McpConfigSection {
  entries: McpConfigEntry[];
  errors: McpSourceError[];
}

export type McpRuntimeStatus =
  "ready" | "no_session" | "session_ended" | "unsupported" | "unavailable";

export interface McpRuntimeEntry {
  name: string;
  status: string | null;
  builtin: boolean;
  toolNames: string[];
  resourcesCount: number;
  templatesCount: number;
}

export interface McpRuntimeSection {
  status: McpRuntimeStatus;
  reason: string | null;
  workspace: string | null;
  sessionId: string | null;
  collectedAt: number | null;
  entries: McpRuntimeEntry[];
}

export interface McpEngineInventory {
  id: McpEngineId;
  available: boolean;
  support: McpEngineSupport;
  sources: McpSourceInfo[];
  config: McpConfigSection;
  runtime: McpRuntimeSection;
}

export interface McpInventory {
  engines: McpEngineInventory[];
  collectedAt: number;
}

export type McpErrorCode =
  | "readonly"
  | "conflict"
  | "not_found"
  | "format"
  | "permission"
  | "invalid_input"
  | "unsupported"
  | "internal";

export type McpProbeStatus = "connected" | "needs_auth" | "failed" | "unsupported";

export interface McpProbePlan {
  kind: "stdio" | "http" | "unknown";
  command: string | null;
  args: string[];
  cwd: string | null;
  envKeys: string[];
  url: string | null;
  headerKeys: string[];
  fingerprint: string;
}

export interface McpProbeResult {
  status: McpProbeStatus;
  message: string | null;
  tools: string[];
  toolCount: number;
  serverName: string | null;
  protocolVersion: string | null;
  elapsedMs: number;
}

export interface McpProbeState {
  result: McpProbeResult;
  checkedAt: number;
  version: string;
}
