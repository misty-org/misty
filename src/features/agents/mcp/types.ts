export type McpConnectionStatus = "unchecked" | "active" | "needs_attention" | "revoked";
export type McpToolRisk = "read" | "write" | "dangerous" | "unknown";

export interface McpConnection {
  id: string;
  name: string;
  endpoint_url: string;
  transport: "streamable_http";
  provider?: "custom" | "activepieces";
  status: McpConnectionStatus;
  last_error_code?: string;
  last_checked_at?: string | null;
  last_discovered_at?: string | null;
  tool_count: number;
  created_at: string;
  updated_at: string;
}

export interface McpToolDescriptor {
  connection_id: string;
  remote_name: string;
  stable_name: string;
  description: string;
  input_schema: Record<string, unknown>;
  schema_status: string;
  disabled_reason?: string;
  default_risk: McpToolRisk;
  approval: "interactive";
  locality: "provider";
  discovered_at: string;
  classification: "known" | "unknown";
  approval_required: boolean;
}

export interface McpConnectionInput {
  name: string;
  endpoint_url: string;
  bearer_token?: string;
}
