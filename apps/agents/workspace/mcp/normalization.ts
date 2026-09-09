import type { McpConnection, McpToolDescriptor, McpToolRisk } from "./types";

export interface McpToolWire {
  connection_id?: unknown;
  remote_name?: unknown;
  stable_name?: unknown;
  description?: unknown;
  input_schema?: unknown;
  schema_status?: unknown;
  disabled_reason?: unknown;
  default_risk?: unknown;
  approval?: unknown;
  locality?: unknown;
  discovered_at?: unknown;
}

export function normalizeMcpTool(value: McpToolWire): McpToolDescriptor | null {
  const connectionId = text(value.connection_id, 200);
  const remoteName = text(value.remote_name, 300);
  if (!connectionId || !remoteName) return null;
  const risk = normalizeMcpRisk(value.default_risk);
  return {
    connection_id: connectionId,
    remote_name: remoteName,
    stable_name: text(value.stable_name, 400) || remoteName,
    description: text(value.description, 1_000),
    input_schema: isObject(value.input_schema) ? value.input_schema : {},
    schema_status: text(value.schema_status, 80) || "unknown",
    disabled_reason: text(value.disabled_reason, 300) || undefined,
    default_risk: risk === "unknown" ? "write" : risk,
    approval: "interactive",
    locality: "provider",
    discovered_at: text(value.discovered_at, 80),
    classification: "unknown",
    approval_required: true,
  };
}

export function normalizeMcpRisk(value: unknown): McpToolRisk {
  return value === "read" || value === "write" || value === "dangerous" ? value : "unknown";
}

export function publicMcpOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function validRemoteMcpEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function publicMcpConnection(value: McpConnection): McpConnection {
  return {
    id: value.id,
    name: value.name,
    endpoint_url: value.endpoint_url,
    transport: "streamable_http",
    provider: value.provider === "activepieces" ? "activepieces" : "custom",
    status: value.status,
    last_error_code: value.last_error_code,
    last_checked_at: value.last_checked_at,
    last_discovered_at: value.last_discovered_at,
    tool_count: value.tool_count,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
