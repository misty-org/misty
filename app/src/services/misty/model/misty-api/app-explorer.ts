import type {
  ClaudeEventKind,
  ClipboardOrigin,
  ClipboardPayloadKind,
  DirectorySizeStatus,
  ExplorerLocationKind,
  FileKind,
  SearchQueryScope,
  SearchScanOutcome,
  SearchScanPhase,
  SearchSourceKind,
} from "@/services/misty/model/types/misty-api";
import type { SavedSearchRule } from "./transfers-files";

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
