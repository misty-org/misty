export type SpaceRole = "owner" | "member";
export type StudioScope = { kind: "personal" } | { kind: "space"; spaceId: string };

export interface Space {
  id: string;
  owner_user_id: string;
  name: string;
  role: SpaceRole;
  member_count: number;
  pending_count: number;
  is_personal: boolean;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpaceInvitation {
  id: string;
  space_id: string;
  space_name: string;
  invited_user_id: string;
  invited_user_name: string;
  invited_email: string;
  invited_by_user_id: string;
  expires_at: string;
  created_at: string;
}

export interface SpaceMember {
  space_id: string;
  user_id: string;
  name: string;
  email: string;
  role: SpaceRole;
  joined_at: string;
  read_message_seq: number;
}

export type MessageSpan =
  | { type: "text"; text: string }
  | { type: "mention"; user_id: string; label: string }
  | { type: "mention"; agent_id: string; label: string };

export interface SpaceMessage {
  seq: number;
  id: string;
  space_id: string;
  sender_user_id: string;
  sender_name: string;
  sender_kind: "person" | "agent" | "system";
  sender_agent_id?: string;
  content: MessageSpan[];
  file_node_ids: string[];
  edited_at?: string;
  created_at: string;
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

export type InboxKind = "unread" | "mention" | "agent" | "approval" | "workflow";

export interface SpaceInboxItem {
  id: number;
  space_id: string;
  space_name: string;
  kind: InboxKind;
  message_id?: string;
  event_id?: number;
  payload: Record<string, unknown>;
  seen_at?: string;
  created_at: string;
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

export interface SpaceStudioResource {
  id: string;
  space_id: string;
  creator_user_id: string;
  kind: "agent" | "workflow";
  name: string;
  instructions?: string;
  definition?: Record<string, unknown>;
  enabled: boolean;
  version: number;
  schedules_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpaceRun {
  id: string;
  space_id: string;
  resource_kind: "agent" | "workflow";
  resource_id: string;
  initiated_by_user_id: string;
  billing_user_id: string;
  trigger_kind: string;
  state: "queued" | "running" | "completed" | "failed" | "canceled";
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  error_code?: string;
  created_at: string;
  completed_at?: string;
}

export interface SpacesSnapshot {
  spaces: Space[];
  invitations: SpaceInvitation[];
  limits: { owned: number; memberships: number; people: number; nodes: number };
}
