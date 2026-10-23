import type { ItemVisibility } from "../visibility";
import type { LibraryEditDefinition } from "./common";
export type * from "./member-types";
export type * from "./conversation-types";

interface LibraryFile {
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
  /** A private file opens only for whoever added it. */
  visibility?: ItemVisibility;
  file: LibraryFile;
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

interface LibrarySearchFacet {
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
  utilities: LibrarySearchFacet[];
}

export interface StorageQuotaDimension {
  percentage_used?: number;
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
