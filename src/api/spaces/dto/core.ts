import type { MessageSpan, SpaceRole } from "./common";
import type { MessageAttachment, StorageQuotaDimension } from "./library";
import type { SpaceMessageSender } from "./conversationTypes";
export type * from "./agentArchitectureTypes";
export type * from "./memberTypes";
export type * from "./conversationTypes";

export interface Space {
  id: string;
  is_default: boolean;
  security_domain_id?: string;
  owner_user_id: string;
  name: string;
  role: SpaceRole;
  member_count: number;
  pending_count: number;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpaceInvitation {
  id: string;
  space_id: string;
  space_name: string;
  invited_user_id?: string;
  invited_user_name?: string;
  invited_email: string;
  invited_by_user_id: string;
  inviter_name?: string;
  delivery_status: "pending" | "sent" | "failed";
  expires_at: string;
  created_at: string;
}

export interface CreateSpaceRequest {
  name: string;
}

/** Someone the person already shares a Space with. */
export interface SpacePerson {
  user_id: string;
  name: string;
  email: string;
}

export interface CreateSpaceResult {
  space: Space;
}

export interface SpaceInvitationPreview {
  space_name: string;
  inviter_name: string;
  invited_email: string;
  expires_at: string;
}

export interface SpaceMessage {
  seq: number;
  id: string;
  /** Echoed on create responses/events to reconcile a client-side optimistic row. */
  client_nonce?: string;
  /** Client-only state; confirmed server messages omit it. */
  local_delivery_state?: "sending" | "failed";
  space_id: string;
  conversation_id?: string;
  sender_user_id: string;
  sender_name: string;
  sender_avatar_version?: number;
  sender_kind: "person" | "agent" | "system";
  sender_agent_id?: string;
  sender?: SpaceMessageSender;
  content: MessageSpan[];
  file_node_ids: string[];
  library_item_ids?: string[];
  attachments?: MessageAttachment[];
  reactions?: SpaceMessageReaction[];
  reply_to_message_id?: string;
  edited_at?: string;
  origin?: {
    kind?: string;
    author_name?: string;
    author_avatar_url?: string;
    [key: string]: unknown;
  };
  created_at: string;
}
interface SpaceMessageReaction {
  emoji: string;
  count: number;
  reacted_by_me?: boolean;
}

export interface SpaceNode {
  id: string;
  space_id: string;
  parent_id?: string;
  kind: "folder" | "link";
  display_name: string;
  uploader_user_id: string;
  mime_type: string;
  size_bytes?: number;
  stale: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SpaceEvent {
  id: number;
  space_id: string;
  type: string;
  actor_user_id?: string;
  entity_id?: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SpacesSnapshot {
  spaces: Space[];
  invitations: SpaceInvitation[];
  entitlements: {
    plan?: string;
    space_limit: number;
    max_owned_spaces?: number;
    personal_storage_limit_bytes?: number;
    space_storage_limit_bytes?: number;
    personal_ai_limit?: number;
    unlimited_spaces: boolean;
    unlimited_collaborators: boolean;
  };
  owner_storage: {
    used_bytes: number;
    reserved_bytes: number;
    limit_bytes: number;
    remaining_bytes: number;
    over_quota_since?: string;
    cleanup_notice_until?: string;
    personal?: StorageQuotaDimension;
    spaces: Array<{
      space_id: string;
      name: string;
      used_bytes: number;
      reserved_bytes: number;
    }>;
  };
}
