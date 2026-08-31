import type { WorkflowVersion } from "./agentArchitectureTypes";

import type {
  InboxKind,
  MessageSpan,
  SpaceRole,
  SpaceTaskPriority,
  SpaceTaskStatus,
} from "../types/types";
import type { SpaceTaskSourceRef } from "./agentTaskTypes";
import type { MessageAttachment } from "./library";
import type { SpaceMessageAgentRun, SpaceMessageSender } from "./conversationTypes";
export type * from "./actionSuggestionTypes";
export type * from "./agentArchitectureTypes";
export type * from "./agentTaskTypes";
export type * from "./conversationTypes";

export interface Space {
  id: string;
  kind?: "standard" | "misty";
  security_domain_id?: string;
  owner_user_id: string;
  name: string;
  role: SpaceRole;
  member_count: number;
  pending_count: number;
  is_shared: boolean;
  permissions?: Record<string, boolean>;
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

export type SpaceIntegrationProvider = "github";

export interface SpaceTemplateSeedSummary {
  task_count: number;
  note_count: number;
  collection_count: number;
}

export interface SpaceTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  recommended_integrations: SpaceIntegrationProvider[];
  seed_summary: SpaceTemplateSeedSummary;
}

export interface CreateSpaceRequest {
  name: string;
  template_id: string;
  integration_providers: SpaceIntegrationProvider[];
}

export interface SpaceSetup {
  selected_providers: SpaceIntegrationProvider[];
  completed_providers: SpaceIntegrationProvider[];
  pending_providers: SpaceIntegrationProvider[];
}

export interface CreateSpaceResult {
  space: Space;
  setup: SpaceSetup;
}

export interface SpaceInvitationPreview {
  space_name: string;
  inviter_name: string;
  invited_email: string;
  expires_at: string;
}

export interface SpaceTask {
  id: string;
  space_id: string;
  task_number: number;
  task_key: string;
  title: string;
  notes: string;
  status: SpaceTaskStatus;
  priority: SpaceTaskPriority;
  rank: number;
  assignee_user_id?: string;
  assignee_agent_id?: string;
  due_at?: string;
  due_timezone: string;
  source_refs: SpaceTaskSourceRef[];
  created_by_user_id?: string;
  created_by_agent_id?: string;
  source_run_id?: string;
  version: number;
  completed_at?: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SpaceTaskPage {
  tasks: SpaceTask[];
  next_cursor?: string;
  status_totals: Record<SpaceTaskStatus, number>;
}

export interface SpaceTaskMoveResult {
  task: SpaceTask;
  reordered: SpaceTask[];
}

export interface SpaceCalendarSource {
  id: string;
  space_id: string;
  integration_id: string;
  connected_by_user_id: string;
  provider: string;
  external_calendar_id: string;
  display_name: string;
  timezone: string;
  watch_expires_at?: string;
  status: "pending" | "syncing" | "active" | "needs_attention" | "disabled";
  last_error_code?: string;
  last_reconciled_at?: string;
  disabled_at?: string;
  created_at: string;
  updated_at: string;
}

export interface GoogleCalendarChoice {
  id: string;
  summary: string;
  timeZone: string;
  primary?: boolean;
  accessRole: string;
}

export interface SpaceCalendarEvent {
  id: string;
  space_id: string;
  source_id: string;
  provider: string;
  external_event_id: string;
  fingerprint: string;
  title: string;
  description: string;
  location: string;
  meeting_url: string;
  organizer: Record<string, unknown>;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  status: "confirmed" | "tentative" | "canceled";
  provider_created_at?: string;
  provider_updated_at?: string;
  removed_at?: string;
  created_at: string;
  updated_at: string;
  version?: number;
  audience_kind?: "space" | "conversation";
  audience_conversation_id?: string;
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
  triggered_runs?: SpaceMessageAgentRun[];
  origin?: {
    kind?: string;
    author_name?: string;
    author_avatar_url?: string;
    [key: string]: unknown;
  };
  social_provider?: "misty" | "instagram" | "discord" | "messenger" | "x";
  social_external_id?: string;
  social_direction?: "inbound" | "outbound";
  social_delivery_state?:
    "queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "cancelled";
  created_at: string;
}
export interface SpaceMessageReaction {
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
  description?: string;
  icon?: string;
  model_mode?: "automatic" | "pinned";
  model_id?: string;
  instructions?: string;
  definition?: Record<string, unknown>;
  enabled: boolean;
  status?: "available" | "disabled" | string;
  runtime_kind?: "cloud" | "device" | string;
  version: number;
  schedules_enabled: boolean;
  stable_identifier?: string;
  active_workflow_version_id?: string;
  active_workflow?: WorkflowVersion;
  access_policy?: { mode: "space" | "selected"; allowedUserIds: string[] };
  created_at: string;
  updated_at: string;
}

export interface SpacesSnapshot {
  spaces: Space[];
  invitations: SpaceInvitation[];
  entitlements: {
    space_limit: number;
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
    spaces: Array<{
      space_id: string;
      name: string;
      used_bytes: number;
      reserved_bytes: number;
    }>;
  };
}
