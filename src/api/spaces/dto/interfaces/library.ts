import type { LibraryEditDefinition } from "../types/types";
export type * from "./actionSuggestionTypes";
export type * from "./agentArchitectureTypes";
export type * from "./agentTaskTypes";
export type * from "./conversationTypes";

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

export interface StorageQuotaDimension {
  used_bytes: number;
  reserved_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
  over_quota?: boolean;
}

export interface SpaceStorageUsage {
  space_id: string;
  owner_user_id?: string;
  storage_available?: boolean;
  /** Explicit dimensions sent by current servers. */
  personal?: StorageQuotaDimension;
  space?: StorageQuotaDimension;
  personal_used_bytes?: number;
  personal_reserved_bytes?: number;
  personal_limit_bytes?: number;
  personal_remaining_bytes?: number;
  personal_over_quota?: boolean;
  space_used_bytes?: number;
  space_reserved_bytes?: number;
  space_limit_bytes?: number;
  space_remaining_bytes?: number;
  space_over_quota?: boolean;
  /** Compatibility fields. Current servers mirror the personal dimension. */
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
