export interface MobileMessageAttachment {
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

export type MobileMessageSpan =
  | { type: "text"; text: string }
  | { type: "mention"; user_id: string; label: string }
  | { type: "mention"; agent_id: string; label: string }
  | { type: "link"; label: string; url: string };

export interface VersionedMobileRecord {
  schemaVersion: 1;
  accountId: string;
  updatedAt: string;
}

export interface MobileOfflineSnapshotRecord extends VersionedMobileRecord {
  kind: "snapshot";
  domain: "spaces" | "activity" | "planner" | "notes" | "library" | "inbox" | "agents";
  value: unknown;
}

export interface MobileChatDraftRecord extends VersionedMobileRecord {
  kind: "chat-draft";
  spaceId: string;
  conversationId: string;
  text: string;
  selectedFileIds: string[];
  selectedLibraryIds: string[];
  pendingAttachments: MobileMessageAttachment[];
  replyToMessageId: string;
  selectedAgentIdsByLabel: Record<string, string>;
}

export interface MobileQueuedChatSubmissionRecord extends VersionedMobileRecord {
  kind: "queued-chat-submission";
  clientNonce: string;
  spaceId: string;
  conversationId: string;
  content: MobileMessageSpan[];
  fileNodeIds: string[];
  attachmentIds: string[];
  libraryItemIds: string[];
  replyToMessageId: string;
}

export interface MobilePendingNoteUpdateRecord extends VersionedMobileRecord {
  kind: "pending-note-update";
  spaceId: string;
  noteId: string;
  yjsUpdateBase64: string;
}
