export type SpaceActorRef =
  | { kind: "person"; user_id: string; agent_id?: never }
  | { kind: "agent"; agent_id: string; user_id?: never };

export interface SpaceParticipant {
  kind: "person" | "agent";
  user_id?: string;
  agent_id?: string;
  name: string;
  email?: string;
  avatar?: AgentAvatar;
  joined_at: string;
}

export interface SpaceMessageSender {
  kind: "person" | "agent" | "system";
  user_id?: string;
  agent_id?: string;
  display_name: string;
  avatar_version?: number;
}

export interface SpaceMessageAgentRun {
  id: string;
  agent_id: string;
  state:
    "queued" | "working" | "awaiting_approval" | "completed" | "failed" | "canceled" | "retrying";
  run_id?: string;
  error_code?: string;
  error_message?: string;
}

export interface SpaceConversation {
  id: string;
  kind?: "standard" | "direct" | "misty_support";
  space_id: string;
  title: string;
  created_by_user_id: string;
  direct_user_id?: string;
  direct_agent_id?: string;
  participants: SpaceParticipant[];
  origin: "misty" | "discord" | "slack";
  integration_id?: string;
  external_resource_id?: string;
  external_display_name?: string;
  integration_status?: "active" | "disconnected";
  created_at: string;
  updated_at: string;
}
import type { AgentAvatar } from "./agentTaskTypes";
