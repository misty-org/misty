import type {
  AnalysisBatch,
  AnalysisEstimate,
  AnalysisResult,
  FolderPreflight,
  SmartLibraryAsset,
  SmartLibrarySourceKind,
} from "../api/types";
import { managedAiRequest } from "./aiServerApi";
import { SMART_LIBRARY_PILOT } from "../contracts/smartLibrary";

export interface RegisterSmartLibraryFolderRequest {
  clientLibraryId: string;
  sourceKind: SmartLibrarySourceKind;
  pilotLimit: 500;
}

export interface RegisterSmartLibraryFolderResponse {
  folderId: string;
  allowance: {
    sampleImages: number;
    maximumAnalyzedImages: number;
    sampleIncluded: boolean;
    remainingImages: number;
  };
}

export interface SampleCandidate {
  assetId: string;
  fingerprint: string;
  extension: string;
  sizeBytes: number;
  modifiedBucket: number;
}

export interface SmartLibraryPreviewInput {
  assetId: string;
  fingerprint: string;
  mimeType: string;
  assetKind: string;
  base64?: string;
  extractedText?: string;
  metadata?: Record<string, string>;
  truncated?: boolean;
}

export interface SmartLibraryProgress {
  folderId: string;
  phase: "preflight" | "sample_ready" | "sample_processing" | "sample_review" | "full_processing" | "complete" | "failed";
  successfulImages: number;
  failedImages: number;
  queuedImages: number;
  sampleAssetIds?: string[];
  batches: AnalysisBatch[];
  estimate: AnalysisEstimate;
  nextResultSequence: number;
  emergencyDisabled?: boolean;
  message?: string | null;
  indexStatus?: SemanticReindexStatus;
  /** Compatibility with pre-release servers. */
  reindexStatus?: SemanticReindexStatus;
}

export interface SemanticReindexStatus {
  currentVersion: number;
  embeddingModel: string;
  outdatedAssets: number;
  failedAssets: number;
  upgradeNeeded: boolean;
}

export interface SmartLibraryResultsResponse {
  results: AnalysisResult[];
  nextSequence: number;
}

export interface SemanticSearchHit {
  assetId: string;
  folderId?: string;
  description: string;
  tags: string[];
  suggestedCollections: string[];
  score: number;
  semanticScore?: number;
  lexicalScore?: number;
  matchReasons?: string[];
  assetKind?: string;
  mimeType?: string;
  metadata?: SemanticAssetMetadata;
}

export interface SemanticAssetMetadata {
  contentType?: string;
  primarySubject?: string;
  searchTerms?: string[];
  entities?: string[];
  characters?: string[];
  brands?: string[];
  applications?: string[];
  objects?: string[];
  scenes?: string[];
  activities?: string[];
  colors?: string[];
  visibleText?: string[];
  topics?: string[];
  extractedText?: string;
  [key: string]: unknown;
}

export type SmartLibrarySearchHit = SemanticSearchHit;

export interface SemanticSearchResponse {
  hits: SemanticSearchHit[];
  queryModel?: string;
  indexVersion?: string | number;
  semanticAvailable?: boolean;
}

export interface SemanticReindexAsset {
  assetId: string;
  folderId: string;
  fingerprint: string;
  assetKind: string;
  mimeType: string;
  requiresPreview: boolean;
}

export interface SemanticReindexPlan {
  jobId: string;
  status: string;
  targetVersion: number;
  embeddingModel: string;
  nextCursor?: string | null;
  assets: SemanticReindexAsset[];
}

export interface SemanticReindexInput {
  assetId: string;
  fingerprint: string;
  assetKind: string;
  mimeType: string;
  base64?: string;
  extractedText?: string;
  metadata?: Record<string, string>;
  truncated?: boolean;
}

export interface SemanticReindexCompletion {
  jobId: string;
  status: string;
  completedAssets: number;
  failedAssets: number;
  failures?: Record<string, string>;
}

const basePath = "/ai/smart-library";

export function registerSmartLibraryFolder(body: RegisterSmartLibraryFolderRequest): Promise<RegisterSmartLibraryFolderResponse> {
  return managedAiRequest(`${basePath}/folders`, { method: "POST", body: JSON.stringify(body) });
}

export function submitSmartLibraryPreflight(folderId: string, preflight: FolderPreflight): Promise<{ estimate: AnalysisEstimate }> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/preflight`, {
    method: "POST",
    body: JSON.stringify({
      totalImages: preflight.totalImages,
      supportedImages: preflight.supportedImages,
      unsupportedImages: preflight.unsupportedImages,
      alreadyAnalyzedImages: preflight.alreadyAnalyzedImages,
      changedImages: preflight.changedImages,
      eligibleImages: preflight.eligibleImages,
      requestedImages: Math.min(500, preflight.pilotCappedImages),
    }),
  });
}

export function createSmartLibrarySample(folderId: string, candidates: SampleCandidate[]): Promise<{ assetIds: string[]; estimate: AnalysisEstimate }> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/sample`, {
    method: "POST",
    body: JSON.stringify({ candidates, maximumSampleImages: 25 }),
  });
}

export function approveSmartLibrarySample(folderId: string, previews: SmartLibraryPreviewInput[], finalBatch: boolean): Promise<SmartLibraryProgress> {
  validatePreviewBatch(previews);
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/sample/approve`, {
    method: "POST",
    body: JSON.stringify({ previews, finalBatch, billingMeter: SMART_LIBRARY_PILOT.billingMeter }),
  });
}

export function approveSmartLibraryFolder(folderId: string, previews: SmartLibraryPreviewInput[], finalBatch: boolean): Promise<SmartLibraryProgress> {
  validatePreviewBatch(previews);
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/approve`, {
    method: "POST",
    body: JSON.stringify({ previews, finalBatch, billingMeter: SMART_LIBRARY_PILOT.billingMeter, maximumSuccessfulImages: SMART_LIBRARY_PILOT.maximumSuccessfulImages }),
  });
}

export function fetchSmartLibraryProgress(folderId: string): Promise<SmartLibraryProgress> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/progress`);
}

export function fetchSmartLibraryResults(folderId: string, after: number): Promise<SmartLibraryResultsResponse> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/results?after=${after}`);
}

export function updateSmartLibraryAssetTags(folderId: string, assetId: string, tags: string[]): Promise<{ result: AnalysisResult }> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/assets/${encodeURIComponent(assetId)}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
}

export function submitSmartLibraryRescan(folderId: string, preflight: FolderPreflight): Promise<{ estimate: AnalysisEstimate }> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/rescan`, {
    method: "POST",
    body: JSON.stringify({ changedImages: preflight.changedImages, newImages: preflight.newImages, requestedImages: preflight.pilotCappedImages }),
  });
}

export function searchSemanticAssets(query: string, options: { limit?: number; folderId?: string } = {}): Promise<SemanticSearchResponse> {
  return managedAiRequest(`${basePath}/search`, {
    method: "POST",
    body: JSON.stringify({
      query,
      limit: options.limit ?? 100,
      ...(options.folderId ? { folderId: options.folderId } : {}),
    }),
  });
}

export function planSemanticReindex(options: { folderId?: string; cursor?: string; limit?: number; targetVersion?: number } = {}): Promise<SemanticReindexPlan> {
  return managedAiRequest(`${basePath}/reindex`, {
    method: "POST",
    body: JSON.stringify({
      ...(options.folderId ? { folderId: options.folderId } : {}),
      ...(options.cursor ? { cursor: options.cursor } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.targetVersion ? { targetVersion: options.targetVersion } : {}),
    }),
  });
}

export function completeSemanticReindex(jobId: string, assets: SemanticReindexInput[]): Promise<SemanticReindexCompletion> {
  return managedAiRequest(`${basePath}/reindex/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ assets }),
  });
}

export function searchSmartLibrary(folderId: string, query: string, limit = 100): Promise<SemanticSearchResponse> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/search`, {
    method: "POST",
    body: JSON.stringify({ query, limit }),
  });
}

export async function deleteSmartLibraryFolder(folderId: string): Promise<void> {
  await managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
}

export function candidatesFromAssets(assets: SmartLibraryAsset[]): SampleCandidate[] {
  return assets.map((asset) => ({
    assetId: asset.assetId,
    fingerprint: asset.fingerprint,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    modifiedBucket: Math.floor(asset.modifiedMs / (30 * 24 * 60 * 60 * 1000)),
  }));
}

function validatePreviewBatch(previews: SmartLibraryPreviewInput[]): void {
  if (previews.length === 0 || previews.length > SMART_LIBRARY_PILOT.previewBatchSize) {
    throw new Error("Library analysis batches must contain one to eight previews.");
  }
}
