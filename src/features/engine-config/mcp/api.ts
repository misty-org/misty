// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * The MCP commands (`engine_mcp_*` in `src-tauri/features/engine_config/mcp`), with their errors
 * normalized to a code and a message.
 */
import { invoke } from "@/native/invoke";
import type {
  McpConfigEntry,
  McpErrorCode,
  McpInventory,
  McpLaunchMode,
  McpProbePlan,
  McpProbeResult,
} from "./types";

export class McpHubError extends Error {
  readonly code: McpErrorCode;
  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpHubError";
    this.code = code;
  }
}

function normalize(error: unknown): McpHubError {
  if (error instanceof McpHubError) return error;
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    return new McpHubError(
      typeof record.code === "string" ? (record.code as McpErrorCode) : "internal",
      typeof record.message === "string" ? record.message : String(error),
    );
  }
  return new McpHubError("internal", String(error));
}

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalize(error);
  }
}

export const mcpApi = {
  inventory: (workspace: string | null): Promise<McpInventory> =>
    call<McpInventory>("engine_mcp_inventory", { workspace }),
  setEnabled: (
    entry: McpConfigEntry,
    enabled: boolean,
    workspace: string | null,
  ): Promise<McpConfigEntry> =>
    call<McpConfigEntry>("engine_mcp_set_enabled", {
      request: { entryId: entry.id, enabled, version: entry.version, workspace },
    }),
  /** Writes only Misty's own device setting, never the CLI's config file. */
  setLaunchMode: (
    entry: McpConfigEntry,
    mode: McpLaunchMode,
    workspace: string | null,
  ): Promise<McpConfigEntry> =>
    call<McpConfigEntry>("engine_mcp_set_launch_mode", {
      request: { entryId: entry.id, mode, workspace },
    }),
  /** Shows a config file this page lists in the file manager (its folder when it doesn't exist
   *  yet). Native code refuses any path the inventory doesn't read. */
  reveal: (path: string, workspace: string | null): Promise<void> =>
    call<void>("engine_mcp_reveal", { request: { path, workspace } }),
  /** What a check would run, to confirm first: the full command or address, and only the names
   *  of env vars and headers. Runs nothing. */
  probePlan: (entry: McpConfigEntry, workspace: string | null): Promise<McpProbePlan> =>
    call<McpProbePlan>("engine_mcp_probe_plan", { request: { entryId: entry.id, workspace } }),
  /** An explicit check: native code starts or connects to the real command or address from the
   *  config once and completes the handshake. */
  probe: (
    entry: McpConfigEntry,
    workspace: string | null,
    planFingerprint?: string,
  ): Promise<McpProbeResult> =>
    call<McpProbeResult>("engine_mcp_probe", {
      request: { entryId: entry.id, workspace, planFingerprint },
    }),
};
