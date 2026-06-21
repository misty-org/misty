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
