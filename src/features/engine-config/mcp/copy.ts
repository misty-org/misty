// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * The words of Settings › Tools › MCP servers, from desktop-cc-gui's English strings. Kept in one
 * place so the settings block and the dialogs say the same thing.
 */
import type { McpConfigEntry, McpConfigSource, McpRuntimeStatus } from "./types";

const engineNames: Record<string, string> = {
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
};

export function engineLabel(id: string): string {
  return engineNames[id] ?? id;
}

const sourceLabels: Record<McpConfigSource, string> = {
  claude_user: "User config",
  claude_local: "Workspace-local",
  claude_project: "Project .mcp.json",
  codex_user: "User config",
  codex_project: "Project config",
  kimi_user: "User mcp.json",
  kimi_local: "Workspace .kimi-code/mcp.json",
  kimi_project: "Project .mcp.json (shared)",
  grok_user: "User config.toml",
  grok_project: "Project .grok/config.toml",
  omp_user: "User mcp.json",
  omp_project: "Project .omp/mcp.json",
  opencode_user: "User opencode.json",
  opencode_project: "Project opencode.json",
  agy_user: "User mcp_config.json",
  agy_project: "Workspace .agents/mcp_config.json",
  qoder_user: "User settings.json",
  qoder_local: "Workspace settings.local.json",
  qoder_project: "Project .mcp.json (shared)",
  qoder_cn_user: "User settings.json",
  qoder_cn_local: "Workspace settings.local.json",
  qoder_cn_project: "Project .mcp.json (shared)",
  codebuddy_user: "User mcp.json",
  codebuddy_local: "Workspace .codebuddy/mcp.json",
  codebuddy_project: "Project .mcp.json (shared)",
  dsh_profile: "Profile plugin config",
};

export function sourceLabel(source: string): string {
  return sourceLabels[source as McpConfigSource] ?? source;
}

export const scopeLabels: Record<McpConfigEntry["scope"], string> = {
  user: "User",
  project: "Project",
};

const readonlyReasons: Record<string, string> = {
  unverified_write:
    "This source's switch hasn't been checked against the real CLI, so it's read-only here. Edit the config file to change it.",
  shared_project_file:
    "A shared project .mcp.json: each CLI applies its own rules, so it's read-only here.",
  grok_project_toggle:
    "Grok's project switch also rewrites the user-level disabled_mcp_servers list, so it's read-only here rather than half written.",
  dsh_plugin:
    "dsh serves MCP through plugins (one dsh-mcp-client per server). Add or remove them in the profile's cordis config.",
  jsonc_readonly:
    "This file is JSONC and has comments a write would drop, so it's read-only here. Edit it in your editor.",
  needs_workspace:
    "Claude keeps this switch per folder (its disabledMcpServers in ~/.claude.json). Choose a folder to change it here.",
  omp_server_list:
    "This name is on the disabledServers or enabledServers list of OMP's user mcp.json, which decides whether it runs. Use /mcp enable or /mcp disable in OMP.",
};

/** Why an entry is read-only: its reason code first, then the text the source sent, then a fallback. */
export function readonlyReasonText(entry: McpConfigEntry): string {
  const code = entry.readonlyReasonCode;
  if (code && readonlyReasons[code]) return readonlyReasons[code];
  return entry.readonlyReason ?? "Read-only";
}

export const runtimeStatusText: Record<McpRuntimeStatus, string> = {
  ready: "From the session running now",
  no_session: "No session is running, so there's nothing to observe",
  session_ended: "The session ended; this is the last thing it reported",
  unsupported: "This engine doesn't report its servers at runtime",
  unavailable: "The runtime list isn't available",
};

export const copy = {
  searchPlaceholder: "Search servers",
  toggle: (name: string) => `Enable ${name}`,
  enableHintOn: (name: string) => `${name} is on in its config. Click to turn it off.`,
  enableHintOff: (name: string) => `${name} is off in its config. Click to turn it on.`,
  enabled: "On in config",
  disabled: "Off in config",
  builtin: "Misty",
  readonly: "Read-only",
  supportNone: (name: string) => `${name} has no MCP of its own, so no source is shown for it.`,
  supportPlugin: (name: string) =>
    `${name} serves MCP through plugins; the MCP plugin instances in its profile are listed here.`,
  sourcesTitle: "Files read",
  sourceMissing: "Not created yet",
  transportUnknown: "No transport declared",
  notInstalled: "This CLI isn't installed. Its config still shows and applies once it runs.",
  count: (config: number, runtime: number) => `${config} configured · ${runtime} at runtime`,
  tabCount: (count: number) => `${count} configured`,
  filterAll: "All",
  filterConfig: "Config",
  filterRuntime: "Runtime",
  rowOpen: (name: string) => `Details for ${name}`,
  configTitle: "Configured",
  configEmpty: "No MCP servers are configured for this engine.",
  runtimeTitle: "At runtime",
  runtimeEmpty: "The session reported no MCP servers.",
  runtimeNoMatch: "No server matches.",
  runtimeTools: (count: number) => `${count} ${count === 1 ? "tool" : "tools"}`,
  runtimeStatusUnknown: "Status unknown",
  runtimeSession: (id: string) => `session ${id}`,
  runtimeCollectedAt: (time: string) => `at ${time}`,
  detailEngine: "Engine",
  detailSource: "Source",
  detailScope: "Scope",
  detailState: "Config state",
  detailTransport: "Transport",
  detailCommand: "Command",
  detailUrl: "Address (redacted)",
  detailEnv: "Environment keys",
  detailHeaders: "Header keys",
  detailPath: "Config file",
  reveal: navigator.platform.includes("Mac")
    ? "Reveal in Finder"
    : navigator.platform.includes("Win")
      ? "Reveal in Explorer"
      : "Reveal in file manager",
  detailRestartHint: "Changes apply to new sessions; running sessions keep going as they are.",
  folder: "Folder",
  folderNone: "No folder",
  refresh: "Refresh",
  cancel: "Cancel",
  close: "Close",
  probeCheck: (name: string) => `Check ${name}`,
  probeCheckLabel: "Check",
  probeCheckAll: "Check all",
  probeHint:
    "A check starts the stdio server from its config (npx may download packages) or connects to its address, completes the handshake, then stops it. It only shows that Misty can connect right now. Opening the page checks the servers in your own config, reusing results under 3 minutes old; Check all runs them again. Servers configured inside a folder are never checked on their own, and a check shows what will run first.",
  probeConfirmTitle: "Run the MCP config from this folder?",
  probeConfirmDetail:
    "These servers are defined in config files inside the folder, which can come with a cloned repository. Checking them really starts these commands or connects to these addresses on this computer, so continue only if you trust the repository. Your environment variables aren't filled into addresses or headers during the check.",
  probeConfirmRun: "Run check",
  probeConfirmCommand: "Command",
  probeConfirmCwd: "Folder",
  probeConfirmEnv: "Environment",
  probeConfirmUrl: "Address",
  probeConfirmHeaders: "Headers",
  probeConfirmUnavailable:
    "This server's config couldn't be read, so what it would run can't be shown.",
  probeLastChecked: (time: string) => `checked at ${time}`,
  probePending: "Checking",
  probeConnected: "Connected",
  probeConnectedTools: (count: number) => `Connected · ${count} ${count === 1 ? "tool" : "tools"}`,
  probeNeedsAuth: "Needs sign-in",
  probeFailed: "Failed",
  probeDetailTitle: "Connection check",
  probeServerName: (name: string) => `Server ${name}`,
  probeProtocol: (version: string) => `Protocol ${version}`,
  probeToolList: (tools: string) => `Tools: ${tools}`,
  probeToolListTruncated: (count: number, total: number, tools: string) =>
    `Tools (${count} of ${total} shown): ${tools}`,
  probeCheckedAt: (time: string, ms: number) => `Checked at ${time} · ${ms} ms`,
  unrecognizedProbe: "The MCP check returned a result Misty didn't recognize.",
} as const;
