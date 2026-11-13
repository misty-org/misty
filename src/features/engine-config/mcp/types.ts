// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * MCP inventory IPC types, mirroring `src-tauri/features/engine_config/mcp/mod.rs` (camelCase).
 * Config and runtime are separate sections by design: "enabled in config" and
 * "connected in a session" must never be collapsed into one state.
 */

export type McpEngineId =
  | "claude"
  | "gemini"
  | "qwen"
  | "minimax"
  | "codex"
  | "kimi"
  | "grok"
  | "omp"
  | "opencode"
  | "agy"
  | "qoder"
  | "qoder-cn"
  | "dsh"
  | "codebuddy"
  | "pi";

/** Source ids from native code; the window only shows them (`sourceLabels`). */
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
  | "omp_user"
  | "omp_project"
  | "opencode_user"
  | "opencode_project"
  | "agy_user"
  | "agy_project"
  | "qoder_user"
  | "qoder_local"
  | "qoder_project"
  | "qoder_cn_user"
  | "qoder_cn_local"
  | "qoder_cn_project"
  | "codebuddy_user"
  | "codebuddy_local"
  | "codebuddy_project"
  | "dsh_profile";

/** native (built in) / plugin (provided by a plugin) / none (no MCP). */
export type McpEngineSupport = "native" | "plugin" | "none";

/** A file this page reads for the engine, whether or not it exists yet. */
export interface McpSourceInfo {
  source: McpConfigSource;
  path: string;
  exists: boolean;
}

export interface McpConfigEntry {
  /** Backend-generated id (`source:name`); the UI only echoes it back. */
  id: string;
  engine: McpEngineId;
  name: string;
  source: McpConfigSource;
  scope: "user" | "project";
  /** The config file lives inside the workspace directory, so a cloned repo
   *  can ship it: never auto-probed, and a manual probe asks first
   *  (probe-confirm.ts). `claude_local` is project-scoped but sits in the
   *  person's own ~/.claude.json, so it is false there. */
  workspaceFile: boolean;
  path: string;
  format: "json" | "toml" | "yaml";
  enabled: boolean;
  transport: string | null;
  command: string | null;
  argsCount: number;
  /** Redacted by the backend (userinfo + sensitive query values). */
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
  writable: boolean;
  readonlyReason: string | null;
  /** A reason code the window turns into words; absent on older sources
   *  that still send a literal reason. */
  readonlyReasonCode?: string | null;
  /** Content hash at read time; a mismatch on write means an external edit. */
  version: string;
}

export interface McpSourceError {
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
  /** Sources this page reads (missing files included). */
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

/** The result of a check Misty ran, kept apart from what a CLI session reported. */
export type McpProbeStatus = "connected" | "needs_auth" | "failed" | "unsupported";

/** What a probe would run (`engine_mcp_probe_plan`), shown before probing a
 *  workspace server. Env / header values are never included, only keys; the
 *  URL is redacted and `${ENV}` is left unexpanded. */
export interface McpProbePlan {
  kind: "stdio" | "http" | "unknown";
  command: string | null;
  args: string[];
  cwd: string | null;
  envKeys: string[];
  url: string | null;
  headerKeys: string[];
  /** Hash of the full target; the backend runs a workspace server only
   *  when the probe carries the fingerprint of the plan the person saw. */
  fingerprint: string;
}

export interface McpProbeResult {
  status: McpProbeStatus;
  message: string | null;
  /** Tool names (at most 40, for the details list). */
  tools: string[];
  /** How many tools `tools/list` declared; counts use it, not the cut list. */
  toolCount: number;
  serverName: string | null;
  protocolVersion: string | null;
  elapsedMs: number;
}

/** What a check shows: its result, when it ran and the config version it ran on. */
export interface McpProbeState {
  result: McpProbeResult;
  checkedAt: number;
  /** The config's content hash; when the config changes the old result is dropped. */
  version: string;
}
