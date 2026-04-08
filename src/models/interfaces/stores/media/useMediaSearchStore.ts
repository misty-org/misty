import { create } from "zustand";
import {
  mediaSearchAcknowledgeRemovedAssets,
  mediaSearchApproveAssets,
  mediaSearchComplete,
  mediaSearchPrepareChunk,
  mediaSearchRecordChunk,
  mediaSearchResetDeviceIndex,
  mediaSearchScanMovies,
  mediaSearchSetAssetState,
  mediaSearchSnapshot,
} from "@/stores/backend";
import type { MediaAsset, MediaSearchSnapshot } from "@/models/interfaces/services/misty-api";
import { clearSemanticExplorerSearchCache } from "@/features/explorer/utils/globalSearch";
import {
  deleteMediaSearchAsset,
  deleteMediaSearchDevice,
  indexMediaChunk,
} from "@/stores/media/useMediaSearchServerStore";
import { ManagedAiRequestError } from "@/stores/assistant/useAiServerStore";
import { ensureMediaSearchDeviceReady } from "@/stores/media/useMediaSearchMigrationStore";

export interface MediaIndexEstimate {
  assetIds: string[];
  fileNames: string[];
  fileCount: number;
  remainingDurationMs: number;
  estimatedWeeklyPercent: number;
}

export interface MediaSearchState {
  loaded: boolean;
  loading: boolean;
  indexingAssetId: string | null;
  progress: number;
  error: string | null;
  snapshot: MediaSearchSnapshot | null;
  pendingApproval: MediaIndexEstimate | null;
  load: () => Promise<void>;
  scan: () => Promise<void>;
  requestIndex: (assetIds: string[]) => void;
  confirmIndex: () => Promise<void>;
  cancelIndexApproval: () => void;
  pauseAsset: (assetId: string) => Promise<void>;
  resumeAsset: (assetId: string) => Promise<void>;
  removeAssetIndex: (assetId: string) => Promise<void>;
  clearDeviceIndex: () => Promise<void>;
}
