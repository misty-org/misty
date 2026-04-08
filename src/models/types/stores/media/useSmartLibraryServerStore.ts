import type { SmartLibrarySourceKind } from "@/models/types/services/misty-api";
import type {
  AnalysisBatch,
  AnalysisEstimate,
  AnalysisResult,
  FolderPreflight,
  SmartLibraryAsset,
} from "@/models/interfaces/services/misty-api";
import { managedAiRequest } from "@/stores/assistant/useAiServerStore";
import { SMART_LIBRARY_PILOT } from "@/features/spaces/smartLibrary";

import type {
  RegisterSmartLibraryFolderRequest,
  RegisterSmartLibraryFolderResponse,
  SampleCandidate,
  SmartLibraryPreviewInput,
  SmartLibraryProgress,
  SemanticReindexStatus,
  SmartLibraryResultsResponse,
  SemanticSearchHit,
  SemanticAssetMetadata,
  SemanticSearchResponse,
  SemanticReindexAsset,
  SemanticReindexPlan,
  SemanticReindexInput,
  SemanticReindexCompletion,
} from "@/models/interfaces/stores/media/useSmartLibraryServerStore";

export type SmartLibrarySearchHit = SemanticSearchHit;
