// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { invoke } from "@/native/invoke";
import type {
  McpConfigEntry,
  McpErrorCode,
  McpInventory,
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

export interface McpAddRequest {
  engine: string;
  name: string;
  target:
    { transport: "stdio"; command: string; args: string[] } | { transport: "http"; url: string };
  env: [string, string][];
  headers: [string, string][];
}

export const mcpApi = {
  add: (request: McpAddRequest): Promise<void> => call<void>("engine_mcp_add", { request }),
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
  reveal: (path: string, workspace: string | null): Promise<void> =>
    call<void>("engine_mcp_reveal", { request: { path, workspace } }),
  probePlan: (entry: McpConfigEntry, workspace: string | null): Promise<McpProbePlan> =>
    call<McpProbePlan>("engine_mcp_probe_plan", { request: { entryId: entry.id, workspace } }),
  probe: (
    entry: McpConfigEntry,
    workspace: string | null,
    planFingerprint?: string,
  ): Promise<McpProbeResult> =>
    call<McpProbeResult>("engine_mcp_probe", {
      request: { entryId: entry.id, workspace, planFingerprint },
    }),
};
