import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";

export type ReasoningEffort = "" | "low" | "medium" | "high";
export type AgentRunMode = "ask" | "auto" | "full";
export interface GatewayModel {
  id: string;
  name: string;
  capabilities: string[];
}

export interface GlobalSpaceLibraryHit {
  space_id: string;
  space_name: string;
  item: SpaceLibraryItem;
  deep_link: string;
}

export type PersonalAgentRunState =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_device"
  | "awaiting_intervention"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "canceled";

export interface PersonalAgentRunSummary {
  run_id: string;
  agent_id: string;
  space_id: string;
  space_name: string;
  task_id: string;
  task_key: string;
  task_title: string;
  task_status: string;
  trigger_kind: string;
  source_type: string;
  source_message_id?: string;
  response_message_id?: string;
  input_modality: "text" | "voice";
  state: PersonalAgentRunState;
  has_failed_steps?: boolean;
  phase: string;
  progress: number;
  attempt: number;
  runtime_kind?: string;
  error_code?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  runtime_heartbeat_at?: string;
  owner_user_id: string;
  initial_run_mode: AgentRunMode;
  effective_run_mode: AgentRunMode;
  approval_state: "none" | "pending" | "approved" | "denied" | "expired";
  parent_run_id?: string;
  delegation_depth: number;
  context_bindings: Array<Record<string, unknown>>;
}

export interface PersonalAgentRunStep {
  id: string;
  run_id: string;
  node_id: string;
  state: string;
  attempt: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error_code?: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  updated_at: string;
}

export interface PersonalAgentTaskActivity {
  id: string;
  run_id?: string;
  kind: string;
  message: string;
  created_at: string;
}

export interface PersonalAgentRunDetail {
  summary: PersonalAgentRunSummary;
  instruction: string;
  result: Record<string, unknown>;
  steps: PersonalAgentRunStep[];
  activity: PersonalAgentTaskActivity[];
  approvals: Array<{
    id: string;
    run_id: string;
    tool_name: string;
    summary: string;
    state: "pending" | "approved" | "denied" | "expired";
    expires_at: string;
  }>;
}
