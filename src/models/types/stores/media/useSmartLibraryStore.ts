import { create } from "zustand";
import {
  smartLibraryApplyResults,
  smartLibraryAssetsPage,
  smartLibraryDelete,
  smartLibraryImportFiles,
  smartLibraryPreflightImport,
  smartLibraryPreparePreviews,
  smartLibraryScan,
  smartLibrarySetServerFolderId,
  smartLibrarySnapshot,
} from "@/stores/backend";
import type {
  AnalysisEstimate,
  FolderLibraryStatus,
  SmartLibraryAsset,
  SmartLibraryImportPreflight,
} from "@/models/interfaces/services/misty-api";
import { errorText } from "@/lib/format";
import { clearSemanticExplorerSearchCache } from "@/features/explorer/utils/globalSearch";
import {
  approveSmartLibraryFolder,
  approveSmartLibrarySample,
  candidatesFromAssets,
  completeSemanticReindex,
  createSmartLibrarySample,
  deleteSmartLibraryFolder,
  fetchSmartLibraryProgress,
  fetchSmartLibraryResults,
  planSemanticReindex,
  registerSmartLibraryFolder,
  submitSmartLibraryPreflight,
  submitSmartLibraryRescan,
  updateSmartLibraryAssetTags,
} from "@/stores/media/useSmartLibraryServerStore";
import type {
  SmartLibraryPreviewInput,
  SmartLibraryProgress,
  SemanticReindexInput,
  SemanticReindexPlan,
} from "@/models/interfaces/stores/media/useSmartLibraryServerStore";

import type { SmartLibraryStore } from "@/models/interfaces/stores/media/useSmartLibraryStore";

export type SmartLibraryPhase =
  | "idle"
  | "scanning"
  | "preflight"
  | "uploading"
  | "processing"
  | "reindexing"
  | "review"
  | "complete"
  | "error";
