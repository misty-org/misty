import type {
  ClipboardOrigin,
  ClipboardPayloadKind,
  DirectorySizeStatus,
  ExplorerLocationKind,
  FileKind,
  SearchSourceKind,
} from "@/native/ipc/primitives";
export interface AppSnapshot {
  appName: string;
  version: string;
  migrationStage: string;
  environment: AppEnvironmentSnapshot;
}
interface AppEnvironmentSnapshot {
  homeDir: string;
  mistyDir: string;
  configDir: string;
  dbDir: string;
  cacheDir: string;
  tmpDir: string;
  settingsPath: string;
  mistyConfigPath: string;
  workspacesPath: string;
  commandsPath: string;
  mountPath: string;
  configExists: boolean;
}
interface ClipboardFileRef {
  display_name: string;
  local_path: string;
  provider_type: string;
  remote_name: string;
  remote_path: string;
  is_dir: boolean;
}
interface ClipboardImage {
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
export interface SearchResult {
  entry: FileEntry;
  score: number;
  sourceKind: SearchSourceKind;
  indexedAtMs: number;
  match?: SearchResultMatch;
}
interface SearchResultMatch {
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
