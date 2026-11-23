// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

export type SkillSourceKind = "managed" | "local" | "builtin" | "system" | "plugin";

export type SkillTargetId =
  | "claude"
  | "codex"
  | "kimi"
  | "grok"
  | "pi"
  | "omp"
  | "dsh"
  | "agy"
  | "gemini"
  | "opencode"
  | "qoder"
  | "qoder-cn"
  | "qwen"
  | "codebuddy"
  | "hermes"
  | "agents";

export type SkillTargetState = "off" | "synced" | "orphan";

export interface SkillTargetInfo {
  id: string;
  label: string;
  path: string;
  readonly: boolean;
  available: boolean;
}

export interface SkillRow {
  id: string;
  key: string;
  name: string;
  description: string;
  directory: string;
  sourceDirectory?: string | null;
  readmeUrl: string | null;
  repoOwner: string | null;
  repoName: string | null;
  repoBranch: string | null;
  installedAt: number | null;
  managed: boolean;
  sourceKind: SkillSourceKind;
  readonly: boolean;
  targets: SkillTargetId[];
  targetStates: Record<string, SkillTargetState>;
  targetPaths?: Record<string, string>;
}

export interface SkillsInstalledResult {
  targets: SkillTargetInfo[];
  skills: SkillRow[];
  generatedAt: number;
}

export interface DiscoveredSkill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl: string | null;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  installs?: number;
}

export interface SkillDiscoverResult {
  skills: DiscoveredSkill[];
  cached: boolean;
  generatedAt: number;
}

export interface SkillSearchResult {
  query: string;
  totalCount: number;
  skills: DiscoveredSkill[];
}

export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

export interface SkillUpdateResult {
  updates: Record<string, boolean>;
  checkedAt: number | null;
  cached: boolean;
}

export type SkillActivityAction =
  "install" | "uninstall" | "restore" | "set_targets" | "import" | "delete_local" | string;

export interface SkillActivityEntry {
  ts: number;
  action: SkillActivityAction;
  name?: string | null;
  directory?: string | null;
  targets?: string[] | null;
  source?: string | null;
}

export interface SkillUsageTokens {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

export interface SkillUsageEntry {
  skill: string;
  invocations: number;
  lastUsedAt: string | null;
  tokens: SkillUsageTokens | null;
  installed: boolean;
  skillId: string | null;
  directory: string | null;
}

export interface SkillUsageResult {
  engine: "claude";
  scope: "claude_code_transcripts";
  generatedAt: number | null;
  scannedFiles: number;
  totalInvocations: number;
  cached: boolean;
  skills: SkillUsageEntry[];
  unusedInstalled: { skillId: string | null; directory: string | null; name: string | null }[];
}

export interface SkillTargetResult {
  target: string;
  ok: boolean;
  error: string | null;
  kept?: boolean;
}

export interface SkillMutationResult {
  ok: boolean;
  skill?: SkillRow;
  targetResults?: SkillTargetResult[];
  trashed?: boolean;
  restoreId?: string | null;
  ttlMs?: number;
}

export interface SkillContentResult {
  directory: string;
  path: string;
  markdown: string;
  truncated: boolean;
}

export interface SkillRemoteContent {
  name: string;
  description: string;
  directory: string;
  path: string;
  url: string;
  repoUrl: string;
  markdown: string;
  truncated: boolean;
  branch: string;
}

export type SkillsMutation =
  | {
      action: "install";
      force?: boolean;
      skill: {
        name: string;
        description: string;
        directory: string;
        repoOwner: string;
        repoName: string;
        repoBranch: string;
      };
      targets: SkillTargetId[];
    }
  | { action: "uninstall"; id: string }
  | { action: "restore"; id: string }
  | { action: "set_targets"; id: string; targets: SkillTargetId[] }
  | { action: "import_local"; directory: string; targets: SkillTargetId[] }
  | { action: "delete_local"; directory: string; targets?: SkillTargetId[] }
  | { action: "add_repo"; repo: { owner: string; name: string; branch: string } }
  | { action: "remove_repo"; owner: string; name: string };

export type SkillErrorCode =
  | "rate_limited"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "readonly"
  | "permission"
  | "network"
  | "http"
  | "internal";
