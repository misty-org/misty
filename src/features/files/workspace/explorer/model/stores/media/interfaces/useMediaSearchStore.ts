import type { MediaSearchSnapshot } from "@/native/contracts";

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
