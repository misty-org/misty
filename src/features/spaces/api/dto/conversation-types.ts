interface SpaceParticipant {
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
  /** standard is a group chat, public to the Space; dm is seen only by the people in it. */
  kind?: "standard" | "dm";
  space_id: string;
  title: string;
  created_by_user_id: string;
  participants: SpaceParticipant[];
  /** Messages from others the person hasn't read, up to 100; only the conversation list has it. */
  unread_count?: number;
  created_at: string;
  updated_at: string;
}
import type { AgentAvatar } from "./member-types";
