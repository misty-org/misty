import { appSnapshot } from "@/stores/backend";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { readAccountAuthToken } from "@/stores/account/useAuthTokenStore";
import type { AgentCitation } from "@/models/interfaces/features/agents/types";

import type { AiMode, FileOperation } from "@/models/types/stores/assistant/useAiServerStore";

export interface ToolDefinition {
  name: string;
  risk: "read" | "write" | "dangerous";
}

export interface ToolManifest {
  tools: ToolDefinition[];
}

export interface AgentMessageRequest {
  mode: AiMode;
  user_message: string;
  active_root?: string;
  selected_paths?: string[];
  capabilities: ToolManifest;
}

export interface ToolRequest {
  id: string;
  name: string;
  risk: "read" | "write" | "dangerous";
  approval_required: boolean;
  arguments?: unknown;
}

export interface ToolResult {
  request_id: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface FileOperationPlan {
  summary: string;
  completion_summary?: string;
  operations: FileOperation[];
  warnings: string[];
}

export interface AgentEvent {
  sequence: number;
  type: "assistant_message" | "tool_request" | "file_plan" | "error";
  run_id?: string;
  text?: string;
  tool_requests?: ToolRequest[];
  file_plan?: FileOperationPlan;
  message?: string;
  created_at: string;
  credits_used?: number;
  credits_remaining?: number;
  citations?: AgentCitation[];
}

export interface AgentEventsResponse {
  events: AgentEvent[];
}

export interface CreateSessionResponse {
  session_id: string;
}

export interface AgentStatusResponse {
  configured: boolean;
  provider: string;
  model: string;
  model_name?: string;
  running: boolean;
  session_id: string | null;
  error: string | null;
}

export interface ManagedAiErrorPayload {
  code?: string;
  message?: string;
  available_credits?: number;
  availableCredits?: number;
  requiredCredits?: number;
  reset_at?: string;
  retry_after_seconds?: number;
}
