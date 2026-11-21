export type * from "./member-types";
export type * from "./conversation-types";

export interface StorageQuotaDimension {
  percentage_used?: number;
  used_bytes: number;
  reserved_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
  over_quota?: boolean;
}

export interface MessageAttachment {
  id: string;
  space_id: string;
  message_id?: string;
  file_id: string;
  upload_id: string;
  uploader_user_id: string;
  display_name: string;
  lifecycle_state: string;
  created_at: string;
}

/** What an attachment's upload answers with. */
export interface LibraryUploadResult {
  attachment?: MessageAttachment;
}
