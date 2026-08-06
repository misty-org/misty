import type { WorkflowVersion } from "@/models/interfaces/features/spaces/agentArchitectureTypes";
import type {
  GlobalImageEditDefinition,
  GlobalImageMarkupElement,
} from "@/models/interfaces/features/editor/imageEditor";
import type { MessageOrigin } from "@/models/interfaces/features/spaces/connections/discord";
import type {
  TaskCalendarLink,
  TaskSchedule,
} from "@/models/interfaces/features/spaces/connections/calendarTasks";
import type { ScheduleField } from "@/models/types/features/spaces/connections/calendarTasks";

import type {
  SpaceRole,
  SpaceTaskStatus,
  SpaceTaskPriority,
  MessageSpan,
  AgentMentionFailure,
  InboxKind,
  BulkLibraryItemAction,
  LibraryEditDefinition,
  LibraryMarkupElement,
} from "@/models/types/features/spaces/types";
import type { SpaceTaskSourceRef } from "./agentTaskTypes";
export type * from "./agentTaskTypes";

export interface Space {
  id: string;
  kind?: "standard";
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

export type SpaceIntegrationProvider = "google" | "discord" | "notion";

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
  /**
   * Schedule fields Google Calendar owns, present on calendar-backed tasks and
   * local drafts. Misty-only tasks leave this unset.
   */
  schedule?: TaskSchedule;
  /** Binding to a Google calendar. Absent on Misty-only tasks. */
  calendar?: TaskCalendarLink;
  /** Set by a sync pass when local edits collide with a Google update. */
  conflicted_fields?: ScheduleField[];
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
  provider: "google" | "misty";
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

export interface SpaceCalendarEvent {
  id: string;
  space_id: string;
  source_id: string;
  provider: "google" | "misty";
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

export interface GoogleCalendarChoice {
  id: string;
  summary: string;
  timeZone: string;
  primary?: boolean;
  accessRole: string;
}

export interface SpaceMessage {
  seq: number;
  id: string;
  space_id: string;
  conversation_id?: string;
  sender_user_id: string;
  sender_name: string;
  sender_avatar_version?: number;
  sender_kind: "person" | "agent" | "system";
  sender_agent_id?: string;
  sender?: import("./conversationTypes").SpaceMessageSender;
  content: MessageSpan[];
  file_node_ids: string[];
  library_item_ids?: string[];
  attachments?: MessageAttachment[];
  reactions?: SpaceMessageReaction[];
  reply_to_message_id?: string;
  edited_at?: string;
  /**
   * Set only on mirrored messages. Absent means Misty-native chat, so every
   * existing caller stays valid and the UI can treat "no origin" as "ours".
   */
  origin?: MessageOrigin;
  triggered_runs?: import("./conversationTypes").SpaceMessageAgentRun[];
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

export interface LibraryFile {
  id: string;
  blob_id: string;
  security_domain_id: string;
  uploader_user_id: string;
  original_filename: string;
  intrinsic_metadata: Record<string, unknown>;
  lifecycle_state: string;
  original_uploaded_at: string;
  version: number;
}

export interface SpaceLibraryItem {
  id: string;
  space_id: string;
  file_id: string;
  contributing_user_id: string;
  display_name: string;
  caption: string;
  tags: string[];
  favorite: boolean;
  hidden: boolean;
  date_override?: string;
  location_override?: Record<string, unknown>;
  contributor_information: Record<string, unknown>;
  current_edit_version_id?: string;
  added_by_user_id: string;
  lifecycle_state: string;
  added_at: string;
  trashed_at?: string;
  recover_until?: string;
  version: number;
  updated_at: string;
  file: LibraryFile;
}

export interface LibraryAssetStackMember {
  item_id: string;
  role: "still" | "motion" | "raw" | "alternate" | "burst_frame";
  position: number;
  display_name?: string;
  original_filename?: string;
  mime_type?: string;
}

export interface LibraryAssetStack {
  id: string;
  space_id: string;
  kind: "live_photo" | "raw_pair" | "burst";
  title: string;
  cover_item_id: string;
  motion_item_id?: string;
  effect: "still" | "loop" | "bounce" | "long_exposure";
  created_by_user_id: string;
  lifecycle_state: string;
  version: number;
  created_at: string;
  updated_at: string;
  members: LibraryAssetStackMember[];
}

export interface LibraryItemQuery {
  after?: string;
  limit?: number;
  collection?: "recently-deleted";
  q?: string;
  sort?: "recently-added" | "date-captured" | "name" | "size" | "album-order";
  direction?: "asc" | "desc";
  media_type?:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "selfies"
    | "live-photos"
    | "portraits"
    | "panoramas"
    | "slo-mo"
    | "cinematic"
    | "bursts"
    | "raw"
    | "screenshots"
    | "screen-recordings"
    | "spatial";
  utility?:
    | "recently-viewed"
    | "recently-edited"
    | "recently-shared"
    | "recently-saved"
    | "recovered"
    | "imports"
    | "featured"
    | "screenshots"
    | "documents"
    | "receipts"
    | "handwriting"
    | "illustrations"
    | "qr-codes";
  visibility?: "visible" | "hidden" | "all";
  album_id?: string;
  favorite?: boolean;
  date_from?: string;
  date_to?: string;
}

export interface LibraryItemsResult {
  items: SpaceLibraryItem[];
  next_after?: string;
}

export interface BulkLibraryItemOptions {
  albumId?: string;
  tags?: string[];
  dateOverride?: string;
  locationOverride?: Record<string, unknown>;
}

export interface LibrarySearchFacet {
  value: string;
  label: string;
  count: number;
}

export interface LibrarySearchFacets {
  total: number;
  favorites: number;
  hidden: number;
  recently_deleted: number;
  tags: LibrarySearchFacet[];
  media_types: LibrarySearchFacet[];
  years: LibrarySearchFacet[];
  albums: LibrarySearchFacet[];
  utilities: LibrarySearchFacet[];
}

export interface LibraryDiscoveryGroup {
  id: string;
  kind: "day" | "month" | "year" | "memory" | "trip" | "duplicate";
  title: string;
  subtitle: string;
  cover_item_id?: string;
  item_count: number;
  start_at?: string;
  end_at?: string;
  music_item_id?: string;
  playback_seconds?: number;
  preference_version?: number;
}

export interface LibraryDiscovery {
  recent_days: LibraryDiscoveryGroup[];
  months: LibraryDiscoveryGroup[];
  years: LibraryDiscoveryGroup[];
  memories: LibraryDiscoveryGroup[];
  trips: LibraryDiscoveryGroup[];
  duplicates: LibraryDiscoveryGroup[];
}

export interface LibraryPinnedCollection {
  id: string;
  space_id: string;
  target_kind: "system" | "album" | "group" | "person" | "memory" | "trip" | "map";
  target_id: string;
  position: number;
  pinned_by_user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryImportHistoryItem {
  id: string;
  direction: "incoming" | "outgoing";
  source_space_id: string;
  destination_space_id: string;
  counterpart_space_name: string;
  item_id: string;
  display_name: string;
  logical_bytes: number;
  state: string;
  created_at: string;
  completed_at?: string;
}

export interface LibrarySharedReference {
  id: string;
  grant_id: string;
  source_space_id: string;
  source_space_name: string;
  source_item_id: string;
  destination_space_id: string;
  destination_space_name: string;
  display_name: string;
  mime_type: string;
  byte_size: number;
  state: string;
  version: number;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SpaceStorageUsage {
  space_id: string;
  storage_available?: boolean;
  /** Usage attributed to the selected Space. */
  space_used_bytes?: number;
  /** Pending storage attributed to the selected Space. */
  space_reserved_bytes?: number;
  /** Usage across the Space owner's shared storage pool. */
  used_bytes?: number;
  reserved_bytes?: number;
  limit_bytes?: number;
  remaining_bytes?: number;
  version?: number;
}

export interface MessageAttachment {
  id: string;
  space_id: string;
  message_id?: string;
  file_id: string;
  upload_id: string;
  uploader_user_id: string;
  display_name: string;
  promoted_item_id?: string;
  lifecycle_state: string;
  created_at: string;
}

export interface LibraryUploadResult {
  item?: SpaceLibraryItem;
  attachment?: MessageAttachment;
}

export interface LibraryAlbum {
  id: string;
  space_id: string;
  folder_id?: string;
  name: string;
  description: string;
  cover_item_id?: string;
  position: number;
  view_mode: "grid" | "list";
  sort_mode: "custom" | "oldest" | "newest";
  created_by_user_id: string;
  item_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryAlbumFolder {
  id: string;
  space_id: string;
  parent_folder_id?: string;
  name: string;
  position: number;
  album_count: number;
  folder_count: number;
  created_by_user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryGroupRule {
  field: "favorite" | "hidden" | "tag" | "mime" | "filename" | "album";
  op: "is" | "contains" | "prefix" | "in";
  value: boolean | string;
}

export interface LibraryGroup {
  id: string;
  space_id: string;
  name: string;
  rules: { all: LibraryGroupRule[] };
  created_by_user_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryIntelligencePolicy {
  space_id: string;
  faces_enabled: boolean;
  pets_enabled: boolean;
  ai_enabled: boolean;
  semantic_search_enabled: boolean;
  version: number;
  queued_face_jobs: number;
  queued_ai_jobs: number;
}

export interface LibraryPerson {
  id: string;
  space_id: string;
  kind: "person" | "pet";
  name: string;
  cover_item_id?: string;
  item_count: number;
  version: number;
  created_at: string;
  updated_at: string;
  lifecycle_state: "active" | "merged" | "deleted";
  merged_into_id?: string;
}

export interface LibraryEditVersion {
  id: string;
  space_library_item_id: string;
  parent_version_id?: string;
  created_by_user_id: string;
  edit_definition: LibraryEditDefinition;
  lifecycle_state: string;
  rendition_state: "none" | "queued" | "processing" | "ready" | "failed";
  rendition_mime_type?: string;
  rendition_byte_size?: number;
  rendition_error_code?: string;
  version_number: number;
  is_current: boolean;
  created_at: string;
  rendition_updated_at: string;
  deleted_at?: string;
}

export interface LibraryRenditionRequest {
  edit_id: string;
  state: "queued" | "processing" | "ready";
  reserved_bytes: number;
}

export interface LibraryEditResult {
  item: SpaceLibraryItem;
  edit?: LibraryEditVersion;
}
export type * from "@/models/interfaces/features/spaces/agentArchitectureTypes";
export type * from "@/models/interfaces/features/spaces/actionSuggestionTypes";
export type * from "@/models/interfaces/features/spaces/conversationTypes";
