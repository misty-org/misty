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
  mimeType: "image/jpeg";
  base64: string;
}

export interface SmartLibraryProgress {
  folderId: string;
  phase: "preflight" | "sample_ready" | "sample_processing" | "sample_review" | "full_processing" | "complete" | "failed";
  successfulImages: number;
  failedImages: number;
  queuedImages: number;
  batches: AnalysisBatch[];
  estimate: AnalysisEstimate;
  nextResultSequence: number;
  emergencyDisabled?: boolean;
  message?: string | null;
}

export interface SmartLibraryResultsResponse {
  results: AnalysisResult[];
  nextSequence: number;
}

export interface SmartLibrarySearchHit {
  assetId: string;
  score: number;
  matchedCollections: string[];
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

export function submitSmartLibraryRescan(folderId: string, preflight: FolderPreflight): Promise<{ estimate: AnalysisEstimate }> {
  return managedAiRequest(`${basePath}/folders/${encodeURIComponent(folderId)}/rescan`, {
    method: "POST",
    body: JSON.stringify({ changedImages: preflight.changedImages, newImages: preflight.newImages, requestedImages: preflight.pilotCappedImages }),
  });
}

export function searchSmartLibrary(folderId: string, query: string, limit = 100): Promise<{ hits: SmartLibrarySearchHit[] }> {
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
    throw new Error("Smart Library analysis batches must contain one to eight previews.");
  }
}
