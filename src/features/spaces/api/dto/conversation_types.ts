import type { ChannelOverwrite, SpacePermission } from "./role_types";
interface SpaceParticipant {
  kind: "person" | "agent";
  user_id?: string;
  agent_id?: string;
  owner_user_id?: string;
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
  kind?: "standard" | "dm";
  voice?: boolean;
  space_id: string;
  title: string;
  created_by_user_id: string;
  participants: SpaceParticipant[];
  unread_count?: number;
  overwrites?: ChannelOverwrite[];
  permissions?: SpacePermission[];
  created_at: string;
  updated_at: string;
}
import type { AgentAvatar } from "./member_types";
