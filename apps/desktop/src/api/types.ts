export type ApiResult<T> = Promise<T>;

export interface AppSnapshot {
  appName: string;
  migrationStage: string;
  proxyUrl: string | null;
  environment: AppEnvironmentSnapshot;
}

export interface AppEnvironmentSnapshot {
  homeDir: string;
  mistyDir: string;
  configDir: string;
  dbDir: string;
  cacheDir: string;
  tmpDir: string;
  assetsDir: string;
  pluginsPublicDir: string;
  pluginsPrivateDir: string;
  settingsPath: string;
  mistyConfigPath: string;
  workspacesPath: string;
  commandsPath: string;
  proxyUrl: string | null;
  serverUrl: string | null;
  grpcAddress: string;
  mountPath: string;
  configExists: boolean;
  derivedEnv: Record<string, string>;
}

export interface ProxySnapshot {
  proxyUrl: string | null;
  ready: boolean;
  statusCode: number | null;
  error: string | null;
}

export type ClipboardPayloadKind = "empty" | "text" | "html" | "image" | "file_refs";
export type ClipboardOrigin = "local_system" | "local_misty" | "remote_shared";

export interface ClipboardFileRef {
  display_name: string;
  local_path: string;
  remote_name: string;
  remote_path: string;
  is_dir: boolean;
}

export interface ClipboardImage {
  mime_type: string;
  blob_id: string;
  checksum: string;
  size_bytes: number;
  width: number;
  height: number;
}

export interface ClipboardPayload {
  kind: ClipboardPayloadKind;
  origin: ClipboardOrigin;
  payload_id: string;
  source_device_id: string;
  source_device_name: string;
  revision: number;
  created_unix_ms: number;
  text: string;
  html: string;
  file_refs: ClipboardFileRef[];
  images: ClipboardImage[];
}

export interface ClipboardSnapshot {
  local: ClipboardPayload;
  shared: ClipboardPayload;
}

export type FileKind = "folder" | "file" | "symlink" | "other";
export type ExplorerLocationKind = "local" | "remote_provider" | "remote";

export interface ExplorerLocation {
  kind: ExplorerLocationKind;
  providerType: string | null;
  remoteName: string | null;
  remotePath: string | null;
}

export interface FileEntry {
  id: string;
  name: string;
  path: string;
  extension: string;
  mimeType: string | null;
  remoteModified: string | null;
  kind: FileKind;
  sizeBytes: number | null;
  modifiedMs: number | null;
  createdMs: number | null;
  readonly: boolean;
  hidden: boolean;
  location: ExplorerLocation;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  location: ExplorerLocation;
  entries: FileEntry[];
  totalCount: number;
  hiddenCount: number;
}

export interface ListDirectoryRequest {
  path?: string | null;
  showHidden?: boolean;
}

export type CreateItemKind = "file" | "folder";

export interface CreateItemRequest {
  directory: string;
  name: string;
  kind: CreateItemKind;
}

export interface RenameItemRequest {
  path: string;
  newName: string;
  sourceIsDirectory?: boolean;
}

export interface RenameItemsRequest {
  items: RenameItemRequest[];
}

export interface DeleteItemsRequest {
  paths: string[];
}

export type ClipboardOperation = "copy" | "move";

export interface PasteItemsRequest {
  sources: PasteItem[];
  destinationDirectory: string;
  operation: ClipboardOperation;
  targetName?: string | null;
}

export interface PasteTextRequest {
  destinationDirectory: string;
  text: string;
  preferredName?: string | null;
}

export interface PasteItem {
  path: string;
  isDirectory: boolean;
}

export interface ExplorerOperationResult {
  affectedPaths: string[];
  parentPath: string | null;
}

export interface PrepareOpenItemRequest {
  path: string;
  sizeBytes?: number | null;
  remoteModified?: string | null;
}

export interface PreparedOpenItem {
  localPath: string;
  cached: boolean;
}

export interface NativeWorkspaceTabSnapshot {
  context_key: string;
  state_key: string;
  title: string;
  restore_state: string;
  idx: number;
}

export interface NativeWorkspacePaneSnapshot {
  pane_id: string;
  tabs: NativeWorkspaceTabSnapshot[];
  closed_tabs: NativeWorkspaceTabSnapshot[];
  active_tab_idx: number;
}

export interface NativeWorkspaceClosedPaneSnapshot extends NativeWorkspacePaneSnapshot {
  restore_mode: string;
  lane_index: number;
  row_index: number;
}

export interface NativeWorkspaceExplorerSnapshot {
  active_pane_id: string;
  next_tab_idx: number;
  next_pane_idx: number;
  grid_pane_ids: string[][];
  grid_split_ratio: number;
  lane_split_ratios: number[];
  panes: NativeWorkspacePaneSnapshot[];
  closed_panes: NativeWorkspaceClosedPaneSnapshot[];
}

export interface NativeWorkspaceFileTabSnapshot {
  idx: number;
  title: string;
  explorer: NativeWorkspaceExplorerSnapshot;
}

export interface NativeWorkspace {
  id: string;
  title: string;
  sidebar_width: number;
  sidebar_visible: boolean;
  inspector_width: number;
  inspector_visible: boolean;
  active_tab_idx: number;
  next_tab_idx: number;
  tabs: NativeWorkspaceFileTabSnapshot[];
  explorer: NativeWorkspaceExplorerSnapshot;
}

export interface NativeWorkspaceDocument {
  schema_version: number;
  active_workspace_id: string;
  next_workspace_idx: number;
  workspaces: NativeWorkspace[];
}

export interface SettingsSnapshot {
  path: string;
  document: Record<string, unknown>;
}

export interface OpenWithAssociation {
  key: string;
  applicationPath: string;
}

export interface SaveSettingsRequest {
  document: Record<string, unknown>;
}

export type ShortcutSource = "default" | "user";

export interface ShortcutBinding {
  commandId: string;
  shortcut: string;
  source: ShortcutSource;
}

export interface ShortcutsSnapshot {
  path: string;
  bindings: ShortcutBinding[];
}

export interface SaveShortcutsRequest {
  bindings: ShortcutBinding[];
}

export interface ProviderHealth {
  ready: boolean;
  port: string | null;
  version: string | null;
  uptimeSeconds: number;
  connectedProviders: number;
  availableProviders: number;
  error: string | null;
}

export interface ProviderRemote {
  name: string;
  type: string;
  statusLabel: string;
  needsReconnect: boolean;
  error: string | null;
}

export interface ProviderWorkflowOption {
  name: string;
  label: string;
  help: string;
  defaultValue: string;
  required: boolean;
  password: boolean;
  choices: Array<{ value: string; help: string }>;
}

export interface ProviderWorkflow {
  type: string;
  name: string;
  description: string;
  options: ProviderWorkflowOption[];
}

export interface ProvidersSnapshot {
  health: ProviderHealth;
  remotes: ProviderRemote[];
  workflows: ProviderWorkflow[];
  loading: boolean;
  error: string | null;
}

export interface RemoteEditDraft {
  name: string;
  originalName: string;
  providerType: string;
  config: Record<string, string>;
  aboutJson: string | null;
  lastCheckedUnix: number | null;
}

export interface SaveRemoteRequest {
  originalName: string;
  name: string;
  parameters: Record<string, string>;
}

export interface RemoteTestResult {
  success: boolean;
  message: string;
  aboutJson: string | null;
  checkedUnix: number | null;
}

export interface RcloneConfigPaths {
  configPath: string | null;
  cachePath: string | null;
  tempPath: string | null;
  rawJson: string;
}

export type TransferType =
  | "upload"
  | "download"
  | "create"
  | "copy"
  | "move"
  | "rename"
  | "delete";

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

export interface TransferRecord {
  id: number;
  jobId: number;
  transferType: TransferType;
  itemType: "local" | "remote";
  status: TransferStatus;
  conflictPolicy: string;
  fileName: string;
  localSourcePath: string;
  localDestPath: string;
  remoteSourceName: string;
  remoteSourcePath: string;
  remoteDestName: string;
  remoteDestPath: string;
  totalBytes: number;
  transferredBytes: number;
  errorMessage: string;
  detailMessage: string;
  queuedAtMs: number;
  startedAtMs: number;
  completedAtMs: number;
  cancelable: boolean;
  retryable: boolean;
  undoable: boolean;
  undoTokenId: number;
}

export interface TransferFilter {
  search?: string;
  offset?: number;
  limit?: number;
}

export interface TransferPage {
  rows: TransferRecord[];
  totalCount: number;
  dbPath: string;
}

export type OperationKind = "copy" | "move" | "create" | "rename" | "delete" | "download";
export type OperationConflictPolicy = "ask" | "replace" | "skip" | "keep_both";
export type OperationStatus =
  | "queued"
  | "in_progress"
  | "waiting_for_resolution"
  | "completed"
  | "failed"
  | "canceled"
  | "skipped";

export interface OperationEndpoint {
  localPath: string;
  remoteName: string;
  remotePath: string;
}

export interface OperationDescriptor {
  operationId: number;
  transferId: number;
  batchId: number;
  kind: OperationKind;
  source: OperationEndpoint;
  target: OperationEndpoint;
  conflictPolicy: OperationConflictPolicy;
  status: OperationStatus;
  preserveOrder: boolean;
  retryable: boolean;
  cancelable: boolean;
  undoable: boolean;
  supportsReplace: boolean;
  supportsKeepBoth: boolean;
  title: string;
  errorMessage: string;
  attempt: number;
}

export interface OperationBatch {
  batchId: number;
  label: string;
  preserveOrder: boolean;
  paused: boolean;
  pausedOperationId: number;
  operationIds: number[];
}

export interface ConflictDialogState {
  open: boolean;
  operationId: number;
  batchId: number;
  applyToBatch: boolean;
  supportsKeepBoth: boolean;
  selectedPolicy: OperationConflictPolicy;
  title: string;
  sourceLabel: string;
  targetLabel: string;
}

export interface OperationQueueSnapshot {
  operations: OperationDescriptor[];
  batches: OperationBatch[];
  conflictDialog: ConflictDialogState;
  activeCount: number;
  maxConcurrent: number;
}

export type FileSyncEndpointKind = "local" | "remote";
export type FileSyncPolicy = "remote_first" | "local_first" | "bi_directional";
export type FileSyncCompareKind = "file" | "folder" | "mismatch";
export type FileSyncCompareDisposition = "left_only" | "right_only" | "different" | "same" | "conflict";
export type FileSyncPlannedAction =
  | "skip"
  | "copy_left_to_right"
  | "copy_right_to_left"
  | "delete_left"
  | "delete_right";

export interface FileSyncEndpoint {
  kind: FileSyncEndpointKind;
  localPath: string;
  remoteName: string;
  remotePath: string;
  providerType: string;
}

export interface FileSyncPair {
  id: number;
  name: string;
  left: FileSyncEndpoint;
  right: FileSyncEndpoint;
  watchMode: boolean;
  stale: boolean;
  preferredPolicy: FileSyncPolicy;
  lastComparedAtMs: number;
  lastScanAtMs: number;
}

export interface FileSyncCompareSide {
  present: boolean;
  isRemote: boolean;
  isDir: boolean;
  size: number;
  lastModified: string;
  absolutePath: string;
  remoteName: string;
  remotePath: string;
}

export interface FileSyncCompareRow {
  relativePath: string;
  kind: FileSyncCompareKind;
  disposition: FileSyncCompareDisposition;
  left: FileSyncCompareSide;
  right: FileSyncCompareSide;
  action: FileSyncPlannedAction;
}

export interface FileSyncCompareResult {
  success: boolean;
  errorMessage: string;
  rows: FileSyncCompareRow[];
  comparedAtMs: number;
}

export interface FileSyncCompareRequest {
  left: FileSyncEndpoint;
  right: FileSyncEndpoint;
  pairId?: number;
}

export interface FileSyncApplyRequest extends FileSyncCompareRequest {
  rows: FileSyncCompareRow[];
}

export interface FileSyncApplyResult {
  appliedCount: number;
  affectedPaths: string[];
}
