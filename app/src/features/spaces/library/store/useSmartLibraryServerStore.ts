import { managedAiRequest } from "@/features/agents";
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

const basePath = "/ai/smart-library";

export function registerSmartLibraryFolder(
  body: RegisterSmartLibraryFolderRequest,
): Promise<RegisterSmartLibraryFolderResponse> {
  return managedAiRequest(`${basePath}/folders`, { method: "POST", body: JSON.stringify(body) });
}

export function submitSmartLibraryPreflight(
  folderId: string,
  preflight: FolderPreflight,
): Promise<{ estimate: AnalysisEstimate }> {
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

export function createSmartLibrarySample(
  folderId: string,
  candidates: SampleCandidate[],
): Promise<{ assetIds: string[]; estimate: AnalysisEstimate }> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/sample`, {
    method: "POST",
    body: JSON.stringify({ candidates, maximumSampleImages: 25 }),
  });
}

export function approveSmartLibrarySample(
  folderId: string,
  previews: SmartLibraryPreviewInput[],
  finalBatch: boolean,
): Promise<SmartLibraryProgress> {
  validatePreviewBatch(previews);
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/sample/approve`, {
    method: "POST",
    body: JSON.stringify({ previews, finalBatch, billingMeter: SMART_LIBRARY_PILOT.billingMeter }),
  });
}

export function approveSmartLibraryFolder(
  folderId: string,
  previews: SmartLibraryPreviewInput[],
  finalBatch: boolean,
): Promise<SmartLibraryProgress> {
  validatePreviewBatch(previews);
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/approve`, {
    method: "POST",
    body: JSON.stringify({
      previews,
      finalBatch,
      billingMeter: SMART_LIBRARY_PILOT.billingMeter,
      maximumSuccessfulImages: SMART_LIBRARY_PILOT.maximumSuccessfulImages,
    }),
  });
}

export function fetchSmartLibraryProgress(folderId: string): Promise<SmartLibraryProgress> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/progress`);
}

export function fetchSmartLibraryResults(
  folderId: string,
  after: number,
): Promise<SmartLibraryResultsResponse> {
  return managedAiRequest(
    `${basePath}/folders/${encodeURIComponent(folderId)}/results?after=${after}`,
  );
}

export function updateSmartLibraryAssetTags(
  folderId: string,
  assetId: string,
  tags: string[],
): Promise<{ result: AnalysisResult }> {
  return managedAiRequest(
    `${basePath}/folders/${encodeURIComponent(folderId)}/assets/${encodeURIComponent(assetId)}/tags`,
    {
      method: "PUT",
      body: JSON.stringify({ tags }),
    },
  );
}

export function submitSmartLibraryRescan(
  folderId: string,
  preflight: FolderPreflight,
): Promise<{ estimate: AnalysisEstimate }> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/rescan`, {
    method: "POST",
    body: JSON.stringify({
      changedImages: preflight.changedImages,
      newImages: preflight.newImages,
      requestedImages: preflight.pilotCappedImages,
    }),
  });
}

export function searchSemanticAssets(
  query: string,
  options: { limit?: number; folderId?: string } = {},
): Promise<SemanticSearchResponse> {
  return managedAiRequest(`${basePath}/search`, {
    method: "POST",
    body: JSON.stringify({
      query,
      limit: options.limit ?? 100,
      ...(options.folderId ? { folderId: options.folderId } : {}),
    }),
  });
}

export function planSemanticReindex(
  options: { folderId?: string; cursor?: string; limit?: number; targetVersion?: number } = {},
): Promise<SemanticReindexPlan> {
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

export function completeSemanticReindex(
  jobId: string,
  assets: SemanticReindexInput[],
): Promise<SemanticReindexCompletion> {
  return managedAiRequest(`${basePath}/reindex/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    body: JSON.stringify({ assets }),
  });
}

export function searchSmartLibrary(
  folderId: string,
  query: string,
  limit = 100,
): Promise<SemanticSearchResponse> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/search`, {
    method: "POST",
    body: JSON.stringify({ query, limit }),
  });
}

export async function deleteSmartLibraryFolder(folderId: string): Promise<void> {
  await managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
  });
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
