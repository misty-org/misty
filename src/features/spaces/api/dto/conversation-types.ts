import type { ChannelOverwrite, SpacePermission } from "./role-types";
interface SpaceParticipant {
  /** An agent answers only when its owner mentions it. */
  kind: "person" | "agent";
  user_id?: string;
  agent_id?: string;
  /** The person an agent participant belongs to. */
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
  /** standard is a group chat, public to the Space; dm is seen only by the people in it. */
  kind?: "standard" | "dm";
  /** A voice channel: people drop into its call (`space:<space>:voice:<id>`) instead of writing. */
  voice?: boolean;
  space_id: string;
  title: string;
  created_by_user_id: string;
  participants: SpaceParticipant[];
  /** Messages from others the person hasn't read, up to 100; only the conversation list has it. */
  unread_count?: number;
  /**
   * Per-role changes to what may be done here. A channel whose default role may not read it is
   * private: only the roles allowed to see it.
   */
  overwrites?: ChannelOverwrite[];
  /** What the person may do in this channel; missing from servers before roles. */
  permissions?: SpacePermission[];
  created_at: string;
  updated_at: string;
}
import type { AgentAvatar } from "./member-types";
