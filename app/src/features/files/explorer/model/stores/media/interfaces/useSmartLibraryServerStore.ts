import type { AnalysisBatch, AnalysisEstimate, AnalysisResult } from "@/native/contracts";
import type { SmartLibrarySourceKind } from "@/native/contracts/primitives";

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
  phase:
    | "preflight"
    | "sample_ready"
    | "sample_processing"
    | "sample_review"
    | "full_processing"
    | "complete"
    | "failed";
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
  hostedAIWeeklyRatio: number;
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
