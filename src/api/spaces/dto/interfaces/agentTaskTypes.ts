import type { SpaceRole } from "../types/types";

export type AgentAvatar =
  | { kind: "preset"; preset_id: string; accent: string }
  | { kind: "upload"; asset_id: string; version: number };

export interface SpaceMember {
  space_id: string;
  user_id: string;
  name: string;
  email: string;
  role: SpaceRole;
  joined_at: string;
  read_message_seq: number;
}

export interface SpaceAgentMembership {
  id: string;
  space_id: string;
  agent_id: string;
  owner_user_id: string;
  can_control: boolean;
  name: string;
  description: string;
  icon: string;
  avatar?: AgentAvatar;
  model_id?: string;
  reasoning_effort?: "" | "low" | "medium" | "high";
  default_run_mode: "ask" | "auto" | "full";
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  work_state?:
    | "ready"
    | "queued"
    | "working"
    | "awaiting_approval"
    | "awaiting_device"
    | "needs_approval"
    | "retrying"
    | "completed"
    | "failed"
    | "canceled"
    | "disabled"
    | "update_available";
  attention_count?: number;
  last_activity_at?: string;
  current_task_id?: string;
}

export type SpaceActor =
  { kind: "person"; id: string } | { kind: "agent"; id: string } | { kind: "system" };

export type SpaceTaskSourceRefKind = "library_item" | "task_attachment" | "chat_attachment";

export interface SpaceTaskSourceRef {
  kind: SpaceTaskSourceRefKind;
  resource_id: string;
  display_name?: string;
  version?: number;
  [key: string]: unknown;
}

export interface SpaceTaskActivity {
  id: string;
  space_id: string;
  task_id: string;
  actor_kind: SpaceActor["kind"];
  actor_user_id?: string;
  actor_agent_id?: string;
  run_id?: string;
  kind: "assigned" | "progress" | "result" | "failure" | "completed" | "status";
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
