import type {
  FileSyncCompareDisposition,
  FileSyncCompareKind,
  FileSyncEndpointKind,
  FileSyncPlannedAction,
  FileSyncPolicy,
  OperationConflictPolicy,
  OperationKind,
  OperationStatus,
  TransferStatus,
  TransferType,
} from "@/native/contracts/primitives";

import type {
  PluginCommandEntry,
  PluginPanelEntry,
  ProviderWorkflowOption,
} from "./workspace-settings";
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
