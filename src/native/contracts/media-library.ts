import type {
  ClipboardOperation,
  CreateItemKind,
  SmartLibraryAssetStatus,
  SmartLibrarySourceKind,
} from "@/native/contracts/primitives";
import type { ExplorerLocation, FileEntry } from "./app-explorer";

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
