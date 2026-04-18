import type {
  ApiResult,
  ClaudeEventKind,
  ClipboardPayloadKind,
  ClipboardOrigin,
  FileKind,
  ExplorerLocationKind,
  DirectorySizeStatus,
  SearchSourceKind,
  SearchScanPhase,
  SearchScanOutcome,
  SearchQueryScope,
  CreateItemKind,
  ClipboardOperation,
  SmartLibrarySourceKind,
  SmartLibraryAssetStatus,
  ShortcutSource,
  PowerToolEndpointKind,
  ProviderConfigMode,
  TransferType,
  TransferStatus,
  OperationKind,
  OperationConflictPolicy,
  OperationStatus,
  FileSyncEndpointKind,
  FileSyncPolicy,
  FileSyncCompareKind,
  FileSyncCompareDisposition,
  FileSyncPlannedAction,
} from "@/models/types/services/misty-api";

export interface AppSnapshot {
  appName: string;
  version: string;
  migrationStage: string;
  storageRuntime: StorageRuntimeSnapshot;
  environment: AppEnvironmentSnapshot;
}

export interface StorageRuntimeSnapshot {
  ready: boolean;
  error: string | null;
  version: string;
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
  serverUrl: string | null;
  grpcAddress: string;
  mountPath: string;
  configExists: boolean;
  derivedEnv: Record<string, string>;
}

export interface StorageSnapshot {
  ready: boolean;
  statusCode: number | null;
  error: string | null;
}

export interface AndroidAllFilesAccessStatus {
  granted: boolean;
  canRequest: boolean;
  storageRoot: string | null;
}

export interface ClaudeStatus {
  installed: boolean;
  running: boolean;
  sessionId: string | null;
  error: string | null;
}

export interface ClaudeSendRequest {
  prompt: string;
  cwd?: string | null;
  resumeSession?: boolean;
}

export interface ClaudeStreamEvent {
  kind: ClaudeEventKind;
  sessionId: string | null;
  text: string;
  toolName: string;
  toolInput: string;
  toolUseId: string;
  toolResult: string;
  costUsd: number;
}

export interface ClipboardFileRef {
  display_name: string;
  local_path: string;
  provider_type: string;
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

export interface NoteAssetStoreRequest {
  accountId: string;
  spaceId: string;
  noteId: string;
  fileName: string;
  mimeType?: string | null;
  bytes: number[];
}

export interface NoteAssetStoreResult {
  path: string;
  name: string;
  mimeType: string | null;
  byteSize: number;
}

export interface MountedDevice {
  id: string;
  volumeId: string;
  name: string;
  mountPath: string;
  fsType: string;
  isRemovable: boolean;
  isSystem: boolean;
  isExternal: boolean;
  isNetwork: boolean;
  writable: boolean;
  totalBytes: number;
  freeBytes: number;
}

export interface DeviceSnapshot {
  devices: MountedDevice[];
}

export interface ExplorerLocation {
  kind: ExplorerLocationKind;
  providerType: string | null;
  remoteName: string | null;
  remotePath: string | null;
}

export interface AndroidGrantedFolder {
  uri: string;
  name: string;
  documentId: string;
  canWrite: boolean;
  path: string;
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
  isDeleted?: boolean;
  location: ExplorerLocation;
}

export interface DirectorySizeRecord {
  path: string;
  sizeBytes: number | null;
  status: DirectorySizeStatus;
  calculatedAtMs: number | null;
  error?: string | null;
}

export interface DirectorySizeRequest {
  paths: string[];
  force?: boolean;
}

export interface SearchScanError {
  source: string;
  message: string;
}

export interface SearchStatus {
  scanInProgress: boolean;
  scanPhase: SearchScanPhase;
  lastScanTimeMs: number | null;
  lastScanOutcome: SearchScanOutcome | null;
  lastScanError: string | null;
  indexedItemCount: number;
  indexedLocalItemCount: number;
  indexedRemoteItemCount: number;
  scanIndexedItemCount: number;
  indexSizeBytes: number;
  currentSource: string | null;
  currentPath: string | null;
  scanErrors: SearchScanError[];
  indexedLocalRoots: string[];
  indexedRemoteNames: string[];
  lastScanAddedItemCount: number;
  lastScanUpdatedItemCount: number;
  lastScanRemovedItemCount: number;
  lastScanUnchangedItemCount: number;
}

export interface SearchScanRequest {
  roots?: string[];
  includeLocal?: boolean;
  includeRemotes?: boolean;
  remoteNames?: string[];
  maxDepth?: number | null;
  ignoredPaths?: string[];
  incremental?: boolean;
}

export interface SearchQueryRequest {
  query: string;
  currentPath?: string | null;
  scope?: SearchQueryScope;
  includeFiles?: boolean;
  includeDirectories?: boolean;
  includeHidden?: boolean;
  limit?: number | null;
  rules?: SavedSearchRule[];
  matchMode?: "all" | "any";
}

export interface SearchResult {
  entry: FileEntry;
  score: number;
  sourceKind: SearchSourceKind;
  indexedAtMs: number;
  match?: SearchResultMatch;
}

export interface SearchResultMatch {
  kind: "filename" | "metadata" | "semantic" | "hybrid";
  semanticScore?: number | null;
  lexicalScore?: number | null;
  reasons?: string[];
  description?: string | null;
  tags?: string[];
  collections?: string[];
  assetKind?: string | null;
  extractedText?: string | null;
  mediaSegmentId?: string | null;
  mediaType?: "audio" | "video" | null;
  mediaStartMs?: number | null;
  mediaEndMs?: number | null;
  mediaMatchKind?: "spoken" | "visual" | null;
  transcript?: string | null;
  visualDescription?: string | null;
}

export interface MediaAsset {
  assetId: string;
  path: string;
  name: string;
  fingerprint: string;
  mediaType: "audio" | "video";
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  modifiedMs: number;
  status: "pending" | "queued" | "processing" | "paused" | "indexed" | "failed" | "unsupported";
  indexedFingerprint: string | null;
  approvedFingerprint: string | null;
  nextChunkIndex: number;
  failureCode: string | null;
}

export interface MediaSearchSnapshot {
  deviceId: string;
  legacyAdoptionPending: boolean;
  rootPath: string;
  maxDurationMinutes: number;
  assets: MediaAsset[];
  ffmpegAvailable: boolean;
  removedAssetIds: string[];
}

export interface PreparedMediaFrame {
  timestampMs: number;
  mimeType: "image/jpeg";
  base64: string;
}

export interface PreparedMediaChunk {
  deviceId: string;
  assetId: string;
  fingerprint: string;
  mediaType: "audio" | "video";
  mimeType: string;
  durationMs: number;
  chunkIndex: number;
  startMs: number;
  endMs: number;
  audioMimeType: string | null;
  audioBase64: string | null;
  frames: PreparedMediaFrame[];
}

export interface ResolvedMediaAsset {
  assetId: string;
  path: string;
  name: string;
  mediaType: "audio" | "video";
  durationMs: number;
}

export interface DirectoryListing {
  path: string;
  title?: string | null;
  parentPath: string | null;
  location: ExplorerLocation;
  entries: FileEntry[];
  totalCount: number;
  hiddenCount: number;
  modifiedMs?: number | null;
  createdMs?: number | null;
}

export interface ExplorerPreviewPayload {
  mimeType: string;
  bytes: number[];
}

export interface GeneratedImageThumbnail {
  path: string;
  mimeType: string;
}

export interface ListDirectoryRequest {
  path?: string | null;
  showHidden?: boolean;
  forceRemoteRefresh?: boolean;
}

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
  permanent?: boolean;
}

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

export interface PasteBlobRequest {
  destinationDirectory: string;
  bytes: number[];
  preferredName?: string | null;
}

export interface SavePreviewRequest {
  path: string;
  bytes: number[];
  saveAsCopy?: boolean;
}

export interface PasteItem {
  path: string;
  isDirectory: boolean;
  sizeBytes?: number | null;
  remoteModified?: string | null;
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

export interface PrepareDragItemsRequest {
  items: PrepareDragItemRequest[];
  sessionId?: string | null;
}

export interface PrepareDragItemRequest {
  path: string;
  isDirectory: boolean;
  sizeBytes?: number | null;
  remoteModified?: string | null;
}

export interface PreparedOpenItem {
  localPath: string;
  cached: boolean;
  sourcePath?: string | null;
  cachePath?: string | null;
  cacheHit?: boolean;
}

export interface PreparedDragItemsResult {
  items: PreparedDragItem[];
  skipped: PreparedDragSkippedItem[];
}

export interface PreparedDragItem {
  sourcePath: string;
  localPath: string;
  isDirectory: boolean;
  cached: boolean;
}

export interface PreparedDragSkippedItem {
  sourcePath: string;
  reason: string;
}

export interface ExplorerLibraryItem {
  path: string;
  name: string;
  id: string;
  isDir: boolean;
  size: number;
  lastModified: string;
  mimeType: string;
  type: number;
  tags?: string[];
  comments?: string | null;
}

export interface ExplorerLibrarySnapshot {
  path: string;
  recentFiles: ExplorerLibraryItem[];
  starredFiles: ExplorerLibraryItem[];
  lastOpenedPath: string;
}

export interface RecordRecentRequest {
  item: ExplorerLibraryItem;
}

export interface RecordLastOpenedRequest {
  path: string;
}

export interface PilotAllowance {
  sampleImages: number;
  maximumAnalyzedImages: number;
  sampleIncluded: boolean;
  remainingImages: number;
}

export interface AnalysisEstimate {
  eligibleImages: number;
  includedImages: number;
  billableImages: number;
  hostedAIWeeklyRatio: number;
}

export interface FolderPreflight {
  totalImages: number;
  supportedImages: number;
  unsupportedImages: number;
  alreadyAnalyzedImages: number;
  changedImages: number;
  newImages: number;
  duplicateImages: number;
  eligibleImages: number;
  pilotCappedImages: number;
  skippedFullOriginalImages: number;
  sampleAssetIds: string[];
  unsupportedReasons: Record<string, number>;
  allowance: PilotAllowance;
  estimate: AnalysisEstimate;
}

export interface SmartLibraryAsset {
  assetId: string;
  relativePath: string;
  name: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  modifiedMs: number;
  fingerprint: string;
  sourceKind: SmartLibrarySourceKind;
  previewSupported: boolean;
  unsupportedReason: string | null;
  status: SmartLibraryAssetStatus;
  description: string | null;
  tags: string[];
  collections: string[];
  confidence: number | null;
  failure: string | null;
  assetKind?: string;
  extractedText?: string | null;
  generatedMetadata?: SmartLibraryGeneratedMetadata | null;
  indexVersion?: string | null;
  indexedFingerprint?: string | null;
}

export interface SmartLibraryGeneratedMetadata {
  contentType: string;
  primarySubject: string;
  searchTerms: string[];
  entities: string[];
  characters: string[];
  brands: string[];
  applications: string[];
  objects: string[];
  scenes: string[];
  activities: string[];
  colors: string[];
  visibleText: string[];
  topics: string[];
}

export interface FolderLibraryStatus {
  libraryId: string;
  serverFolderId: string | null;
  rootPath: string;
  displayName: string;
  sourceKind: SmartLibrarySourceKind;
  createdAtMs: number;
  lastScannedAtMs: number;
  preflight: FolderPreflight;
  assets: SmartLibraryAsset[];
}

export interface SmartLibrarySnapshot {
  activeLibrary: FolderLibraryStatus | null;
}

export interface SmartLibraryImportResult {
  library: FolderLibraryStatus;
  importedAssetIds: string[];
}

export interface SmartLibraryImportPreflight {
  paths: string[];
  fileNames: string[];
  eligiblePaths: string[];
  skippedFiles: Array<{ path: string; reason: string }>;
  eligibleFiles: number;
  unsupportedFiles: number;
  estimate: AnalysisEstimate;
}

export interface SmartLibraryAssetsPageRequest {
  afterAssetId?: string | null;
  limit?: number;
  reindexOnly?: boolean;
  indexVersion?: string | null;
}

export interface SmartLibraryAssetsPage {
  assets: SmartLibraryAsset[];
  nextCursor: string | null;
}

export interface ResolvedSmartLibraryAsset {
  assetId: string;
  path: string;
  relativePath: string;
  name: string;
  sourceKind: SmartLibrarySourceKind;
}

export interface PreparedSmartLibraryPreview {
  assetId: string;
  fingerprint: string;
  mimeType: string;
  assetKind: string;
  extractedText: string | null;
  metadata: Record<string, string>;
  truncated: boolean;
  bytes: number[];
  width: number;
  height: number;
}

export interface AnalysisResult {
  assetId: string;
  status: "analyzed" | "failed";
  description?: string | null;
  tags?: string[];
  suggestedCollections?: string[];
  confidence?: number | null;
  failure?: string | null;
  assetKind?: string | null;
  mimeType?: string | null;
  metadata?: Partial<SmartLibraryGeneratedMetadata> | null;
  indexVersion?: string | null;
}

export interface AnalysisBatch {
  batchId: string;
  assetIds: string[];
  status:
    "pending" | "uploading" | "queued" | "processing" | "completed" | "partially_failed" | "failed";
  completedImages: number;
  failedImages: number;
}

export interface FileMetadataField {
  label: string;
  value: string;
}

export interface FileMetadataSnapshot {
  path: string;
  kind: string;
  sizeBytes?: number | null;
  readonly: boolean;
  hidden: boolean;
  createdMs?: number | null;
  modifiedMs?: number | null;
  accessedMs?: number | null;
  osTags: string[];
  fields: FileMetadataField[];
  extracted: FileMetadataField[];
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
  sidebar_visible: boolean;
  inspector_visible: boolean;
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

export interface LaunchOnLoginSnapshot {
  supported: boolean;
  enabled: boolean;
  target: string;
  detail: string;
}

export interface OpenWithAssociation {
  key: string;
  applicationPath: string;
}

export interface SaveSettingsRequest {
  document: Record<string, unknown>;
}

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

export interface PluginCommandEntry {
  id: string;
  label: string;
  hint: string;
  pluginId: string;
  pluginName: string;
  defaultShortcut: string;
  source: string;
  actionKind: string;
  launcherOpenMode: string;
  requiresSelectedFile: boolean;
  pluginDir: string;
  manifestPath: string;
  libraryPath: string;
}

export interface PluginPanelEntry {
  id: string;
  title: string;
  pluginId: string;
  pluginName: string;
  windowType: string;
  defaultWidth: number;
  defaultHeight: number;
  pluginDir: string;
  manifestPath: string;
  libraryPath: string;
  webEntry: string;
  launcherViews: string[];
}

export interface ExtensionCommandRequest {
  pluginId: string;
  command: string;
  payload?: Record<string, unknown>;
}

export interface PluginCommandsSnapshot {
  roots: string[];
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
}

export interface RunPluginCommandRequest {
  commandId: string;
  selectedPaths?: string[];
}

export interface PluginCommandRunResult {
  commandId: string;
  pluginId: string;
  pluginName: string;
  label: string;
  handled: boolean;
  targetRoute: string;
  message: string;
  notifications: PluginPanelNotification[];
  runtimeStatus: string;
}

export interface RenderPluginPanelRequest {
  panelId: string;
  pluginId?: string;
  selectedPaths?: string[];
  clickedButton?: string;
  inputs?: Record<string, string>;
}

export interface PluginPanelRenderResult {
  panelId: string;
  pluginId: string;
  pluginName: string;
  title: string;
  elements: PluginPanelElement[];
  notifications: PluginPanelNotification[];
  message: string;
  runtimeStatus: string;
}

export interface PluginPanelElement {
  kind: string;
  id: string;
  text: string;
  width: number;
  height: number;
  border: boolean;
}

export interface PluginPanelNotification {
  level: string;
  title: string;
  message: string;
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
  configSource: string;
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

export interface CloudConfigPaths {
  configPath: string | null;
  cachePath: string | null;
  tempPath: string | null;
  rawJson: string;
}

export interface PowerToolEndpoint {
  kind: PowerToolEndpointKind;
  remote?: string;
  path: string;
}

export interface TransferProfileOptions {
  transfers?: number;
  checkers?: number;
  bandwidthLimit?: string;
  retries?: number;
  lowLevelRetries?: number;
  checksum?: boolean;
}

export interface VerifyOptions {
  oneWay?: boolean;
  download?: boolean;
  profile?: TransferProfileOptions;
}

export interface VerifyStartRequest {
  source: PowerToolEndpoint;
  dest: PowerToolEndpoint;
  options?: VerifyOptions;
}

export interface ProviderJobStart {
  jobId: string;
}

export interface ProviderJobStatus {
  jobId: string;
  operation: string;
  state: string;
  phase: string;
  bytesCompleted: number;
  bytesTotal: number;
  bytesPerSecond?: number;
  sourceRemote?: string | null;
  sourcePath?: string | null;
  destRemote?: string | null;
  destPath?: string | null;
  message?: string | null;
  resultReady?: boolean;
  resultKind?: string | null;
}

export interface VerifyResult {
  success: boolean;
  status?: string | null;
  hashType?: string | null;
  missingOnSrc: string[];
  missingOnDst: string[];
  match: string[];
  differ: string[];
  error: string[];
  combined: string[];
}

export interface ProviderConfigRequest {
  name: string;
  providerType: string;
  parameters: Record<string, string>;
  state?: string;
  result?: string;
  mode: ProviderConfigMode;
  continuing?: boolean;
  continueExisting?: boolean;
}

export interface ProviderConfigStep {
  kind: string;
  name: string;
  state: string;
  result: string;
  done: boolean;
  error: string;
  authorizeUrl: string;
  instructions: string;
  pollAfterMs: number;
  option: ProviderWorkflowOption | null;
}

export interface TransferRecord {
  id: number;
  jobId: number;
  operationId: number;
  batchId: number;
  parentTransferId: number;
  rootTransferId: number;
  treeDepth: number;
  transferType: TransferType;
  itemType: "local" | "remote";
  status: TransferStatus;
  conflictPolicy: string;
  queueTitle: string;
  fileName: string;
  localSourcePath: string;
  localDestPath: string;
  remoteSourceName: string;
  remoteSourcePath: string;
  remoteDestName: string;
  remoteDestPath: string;
  totalBytes: number;
  transferredBytes: number;
  bytesPerSecond: number;
  errorMessage: string;
  detailMessage: string;
  queuedAtMs: number;
  startedAtMs: number;
  completedAtMs: number;
  cancelable: boolean;
  retryable: boolean;
  undoable: boolean;
  undoTokenId: number;
  preserveOrder: boolean;
  paused: boolean;
  attempt: number;
  supportsReplace: boolean;
  supportsKeepBoth: boolean;
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

export interface OperationEndpoint {
  localPath: string;
  remoteName: string;
  remotePath: string;
}

export interface OperationDescriptor {
  operationId: number;
  transferId: number;
  batchId: number;
  parentTransferId: number;
  rootTransferId: number;
  treeDepth: number;
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
  paused: boolean;
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
  supportsReplace: boolean;
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
  redoAvailable: boolean;
  paused: boolean;
  bandwidthLimit: string;
  transferProfileId: string;
  transferProfileName: string;
}

export interface ArchiveListRequest {
  path: string;
}

export interface ArchiveEntry {
  path: string;
  isDir: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ArchiveListResult {
  archivePath: string;
  format: string;
  entries: ArchiveEntry[];
  message: string;
}

export interface ArchiveCreateRequest {
  paths: string[];
  destinationPath: string;
}

export interface ArchiveExtractRequest {
  archivePath: string;
  destinationDir: string;
}

export interface ArchiveActionResult {
  archivePath: string;
  destinationPath: string;
  affectedPaths: string[];
  message: string;
}

export interface DuplicateScanRequest {
  roots: string[];
  hashAll?: boolean;
}

export interface DuplicateCandidate {
  path: string;
  sizeBytes: number;
  modifiedMs: number;
  sha256?: string | null;
  remote: boolean;
}

export interface DuplicateGroup {
  key: string;
  sizeBytes: number;
  items: DuplicateCandidate[];
}

export interface DuplicateScanResult {
  scanId: string;
  groups: DuplicateGroup[];
  scannedCount: number;
  hashedCount: number;
  remoteCandidateCount: number;
  remoteHashingApproved: boolean;
  canceled: boolean;
  message: string;
}

export interface SavedSearchRule {
  field: string;
  operator: string;
  value: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  rules: SavedSearchRule[];
  updatedAtMs: number;
}

export interface SavedSearchesSnapshot {
  searches: SavedSearch[];
}

export interface CompareFilesRequest {
  leftPath: string;
  rightPath: string;
}

export interface CompareFilesResult {
  leftPath: string;
  rightPath: string;
  leftSha256: string;
  rightSha256: string;
  same: boolean;
  kind: string;
  message: string;
}

export interface CompareFoldersRequest {
  leftPath: string;
  rightPath: string;
}

export interface CompareFolderRow {
  relativePath: string;
  disposition: string;
  leftSize?: number | null;
  rightSize?: number | null;
}

export interface CompareFoldersResult {
  leftPath: string;
  rightPath: string;
  rows: CompareFolderRow[];
  message: string;
}

export interface FileToolsChecksumRequest {
  path: string;
}

export interface FileToolsChecksumResult {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface FileToolsReadonlyRequest {
  path: string;
  readonly: boolean;
}

export interface FileToolsChmodRequest {
  path: string;
  mode: number;
}

export interface FileToolsSymlinkRequest {
  targetPath: string;
  linkPath: string;
}

export interface FileToolsSymlinkTargetRequest {
  path: string;
}

export interface FileToolsSymlinkTargetResult {
  path: string;
  targetPath: string;
  resolvedTargetPath: string;
  targetExists: boolean;
  targetIsDir: boolean;
}

export interface FileToolsActionResult {
  path: string;
  message: string;
}

export interface PluginDiagnosticsEntry {
  pluginId: string;
  pluginName: string;
  pluginDir: string;
  installed: boolean;
  enabled: boolean;
  runtimeStatus: string;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
  missingDependencies: string[];
  errors: string[];
}

export interface PluginDiagnosticsSnapshot {
  roots: string[];
  plugins: PluginDiagnosticsEntry[];
  removedIds: string[];
}

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
