import type { SemanticReindexPlan, SmartLibraryProgress } from "@/features/files/explorer";
import type {
  AnalysisEstimate,
  FolderLibraryStatus,
  SmartLibraryImportPreflight,
} from "@/native/contracts";
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
