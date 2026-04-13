import { appSnapshot } from "@/stores/backend";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { readAccountAuthToken } from "@/stores/account/useAuthTokenStore";
import type { AgentCitation } from "@/models/interfaces/features/agents/types";

import type {
  ToolDefinition,
  ToolManifest,
  AgentMessageRequest,
  ToolRequest,
  ToolResult,
  FileOperationPlan,
  AgentEvent,
  AgentEventsResponse,
  CreateSessionResponse,
  AgentStatusResponse,
  ManagedAiErrorPayload,
} from "@/models/interfaces/stores/agent/useAiServerStore";

export type AiMode = "ask" | "auto" | "full";

export type FileOperation =
  | { type: "mkdir"; path: string; reason?: string }
  | { type: "move"; from: string; to: string; reason?: string; confidence?: number }
  | { type: "rename"; from: string; to: string; reason?: string; confidence?: number };
