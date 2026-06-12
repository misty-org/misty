import { smartLibraryApi } from "@/api/ai/smart-library";
import type {
  RegisterSmartLibraryFolderRequest,
  RegisterSmartLibraryFolderResponse,
  SampleCandidate,
  SemanticReindexCompletion,
  SemanticReindexInput,
  SemanticReindexPlan,
  SemanticSearchHit,
  SemanticSearchResponse,
  SmartLibraryPreviewInput,
  SmartLibraryProgress,
  SmartLibraryResultsResponse,
} from "@/features/files/explorer";
import type {
  AnalysisEstimate,
  AnalysisResult,
  FolderPreflight,
  SmartLibraryAsset,
} from "@/native/contracts";
import { SMART_LIBRARY_PILOT } from "../smartLibrary";
export type {
  RegisterSmartLibraryFolderRequest,
  RegisterSmartLibraryFolderResponse,
  SampleCandidate,
  SemanticAssetMetadata,
  SemanticReindexAsset,
  SemanticReindexCompletion,
  SemanticReindexInput,
  SemanticReindexPlan,
  SemanticReindexStatus,
  SemanticSearchHit,
  SemanticSearchResponse,
  SmartLibraryPreviewInput,
  SmartLibraryProgress,
  SmartLibraryResultsResponse,
} from "@/features/files/explorer";

export function registerSmartLibraryFolder(
  body: RegisterSmartLibraryFolderRequest,
): Promise<RegisterSmartLibraryFolderResponse> {
  return smartLibraryApi.registerFolder(body);
}

export function submitSmartLibraryPreflight(
  folderId: string,
  preflight: FolderPreflight,
): Promise<{ estimate: AnalysisEstimate }> {
  return smartLibraryApi.submitPreflight(folderId, {
    totalImages: preflight.totalImages,
    supportedImages: preflight.supportedImages,
    unsupportedImages: preflight.unsupportedImages,
    alreadyAnalyzedImages: preflight.alreadyAnalyzedImages,
    changedImages: preflight.changedImages,
    eligibleImages: preflight.eligibleImages,
    requestedImages: Math.min(500, preflight.pilotCappedImages),
  });
}

export function createSmartLibrarySample(
  folderId: string,
  candidates: SampleCandidate[],
): Promise<{ assetIds: string[]; estimate: AnalysisEstimate }> {
  return smartLibraryApi.createSample(folderId, { candidates, maximumSampleImages: 25 });
}

export function approveSmartLibrarySample(
  folderId: string,
  previews: SmartLibraryPreviewInput[],
  finalBatch: boolean,
): Promise<SmartLibraryProgress> {
  validatePreviewBatch(previews);
  return smartLibraryApi.approveSample(folderId, {
    previews,
    finalBatch,
    billingMeter: SMART_LIBRARY_PILOT.billingMeter,
  });
}

export function approveSmartLibraryFolder(
  folderId: string,
  previews: SmartLibraryPreviewInput[],
  finalBatch: boolean,
): Promise<SmartLibraryProgress> {
  validatePreviewBatch(previews);
  return smartLibraryApi.approveFolder(folderId, {
    previews,
    finalBatch,
    billingMeter: SMART_LIBRARY_PILOT.billingMeter,
    maximumSuccessfulImages: SMART_LIBRARY_PILOT.maximumSuccessfulImages,
  });
}

export function fetchSmartLibraryProgress(folderId: string): Promise<SmartLibraryProgress> {
  return smartLibraryApi.progress(folderId);
}

export function fetchSmartLibraryResults(
  folderId: string,
  after: number,
): Promise<SmartLibraryResultsResponse> {
  return smartLibraryApi.results(folderId, after);
}

export function updateSmartLibraryAssetTags(
  folderId: string,
  assetId: string,
  tags: string[],
): Promise<{ result: AnalysisResult }> {
  return smartLibraryApi.updateAssetTags(folderId, assetId, tags);
}

export function submitSmartLibraryRescan(
  folderId: string,
  preflight: FolderPreflight,
): Promise<{ estimate: AnalysisEstimate }> {
  return smartLibraryApi.submitRescan(folderId, {
    changedImages: preflight.changedImages,
    newImages: preflight.newImages,
    requestedImages: preflight.pilotCappedImages,
  });
}

export function searchSemanticAssets(
  query: string,
  options: { limit?: number; folderId?: string } = {},
): Promise<SemanticSearchResponse> {
  return smartLibraryApi.search({
    query,
    limit: options.limit ?? 100,
    ...(options.folderId ? { folderId: options.folderId } : {}),
  });
}

export function planSemanticReindex(
  options: { folderId?: string; cursor?: string; limit?: number; targetVersion?: number } = {},
): Promise<SemanticReindexPlan> {
  return smartLibraryApi.planReindex({
    ...(options.folderId ? { folderId: options.folderId } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.limit ? { limit: options.limit } : {}),
    ...(options.targetVersion ? { targetVersion: options.targetVersion } : {}),
  });
}

export function completeSemanticReindex(
  jobId: string,
  assets: SemanticReindexInput[],
): Promise<SemanticReindexCompletion> {
  return smartLibraryApi.completeReindex(jobId, assets);
}

export function searchSmartLibrary(
  folderId: string,
  query: string,
  limit = 100,
): Promise<SemanticSearchResponse> {
  return smartLibraryApi.searchFolder(folderId, query, limit);
}

export async function deleteSmartLibraryFolder(folderId: string): Promise<void> {
  await smartLibraryApi.removeFolder(folderId);
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

export type SmartLibrarySearchHit = SemanticSearchHit;
