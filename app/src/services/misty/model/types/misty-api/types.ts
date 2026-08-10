export type ApiResult<T> = Promise<T>;

export type ClaudeEventKind = "system" | "text" | "tool_use" | "tool_result" | "result" | "error";

export type ClipboardPayloadKind = "empty" | "text" | "html" | "image" | "file_refs";

export type ClipboardOrigin = "local_system" | "local_misty" | "remote_shared";

export type FileKind = "folder" | "file" | "symlink" | "other";

export type ExplorerLocationKind = "local" | "remote_provider" | "remote";

export type DirectorySizeStatus = "unknown" | "calculating" | "ready" | "failed";

export type SearchSourceKind = "local" | "remote";

export type SearchScanPhase = "idle" | "scanning" | "canceling" | "committing";

export type SearchScanOutcome = "completed" | "canceled" | "failed";

export type SearchQueryScope = "current" | "local" | "remotes" | "everything";

export type CreateItemKind = "file" | "folder";

export type ClipboardOperation = "copy" | "move";

export type SmartLibrarySourceKind = "local" | "cloud";

export type SmartLibraryAssetStatus =
  "pending" | "queued" | "analyzed" | "failed" | "changed" | "unsupported";

export type ShortcutSource = "default" | "user";

export type PowerToolEndpointKind = "local" | "remote";

export type ProviderConfigMode = "add" | "repair";

export type TransferType =
  "upload" | "download" | "create" | "copy" | "move" | "rename" | "delete" | "archive";

export type TransferStatus =
  | "queued"
  | "pending"
  | "in_progress"
  | "waiting_for_resolution"
  | "completed"
  | "failed"
  | "canceled"
  | "skipped"
  | "interrupted";

export type OperationKind =
  "copy" | "move" | "create" | "rename" | "delete" | "upload" | "download" | "archive";

export type OperationConflictPolicy = "ask" | "replace" | "skip" | "keep_both";

export type OperationStatus =
  | "queued"
  | "in_progress"
  | "waiting_for_resolution"
  | "completed"
  | "failed"
  | "canceled"
  | "skipped";

export type FileSyncEndpointKind = "local" | "remote";

export type FileSyncPolicy = "remote_first" | "local_first" | "bi_directional";

export type FileSyncCompareKind = "file" | "folder" | "mismatch";

export type FileSyncCompareDisposition =
  "left_only" | "right_only" | "different" | "same" | "conflict";

export type FileSyncPlannedAction =
  "skip" | "copy_left_to_right" | "copy_right_to_left" | "delete_left" | "delete_right";
