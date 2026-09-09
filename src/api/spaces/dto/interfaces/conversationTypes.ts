export type SpaceActorRef = { kind: "person"; user_id: string };

export interface SpaceParticipant {
  kind: "person";
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

export interface SpaceConversation {
  id: string;
  kind?: "standard" | "direct";
  space_id: string;
  title: string;
  created_by_user_id: string;
  direct_user_id?: string;
  direct_agent_id?: string;
  participants: SpaceParticipant[];
  origin?: string;
  integration_id?: string;
  external_resource_id?: string;
  external_display_name?: string;
  integration_status?: "active" | "disconnected";
  created_at: string;
  updated_at: string;
}
import type { AgentAvatar } from "./agentTaskTypes";
