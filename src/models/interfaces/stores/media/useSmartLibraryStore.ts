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

import type { SmartLibraryPhase } from "@/models/types/stores/media/useSmartLibraryStore";

export interface SmartLibraryStore {
  loaded: boolean;
  phase: SmartLibraryPhase;
  library: FolderLibraryStatus | null;
  progress: SmartLibraryProgress | null;
  estimate: AnalysisEstimate | null;
  reindexPlan: SemanticReindexPlan | null;
  reindexProcessed: number;
  error: string | null;
  pendingDrop: SmartLibraryImportPreflight | null;
  load: () => Promise<void>;
  chooseFolder: (rootPath: string) => Promise<void>;
  addFiles: (paths: string[]) => Promise<void>;
  requestDroppedFiles: (paths: string[]) => Promise<void>;
  confirmDroppedFiles: () => Promise<void>;
  cancelDroppedFiles: () => void;
  discoverChanges: () => Promise<void>;
  rescan: () => Promise<void>;
  trySample: () => Promise<void>;
  analyzeFolder: () => Promise<void>;
  refreshProgress: () => Promise<void>;
  checkIndexUpgrade: () => Promise<void>;
  upgradeIndex: () => Promise<void>;
  setAssetTags: (assetId: string, tags: string[]) => Promise<void>;
  removeLibrary: () => Promise<void>;
}
