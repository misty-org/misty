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
} from "../api/misty";
import type { MediaAsset, MediaSearchSnapshot } from "../api/types";
import { clearSemanticExplorerSearchCache } from "../pages/Files/utils/globalSearch";
import {
  deleteMediaSearchAsset,
  deleteMediaSearchDevice,
  indexMediaChunk,
} from "./mediaSearchServerApi";
import { ManagedAiRequestError } from "./aiServerApi";
import { ensureMediaSearchDeviceReady } from "./mediaSearchMigration";

export interface MediaIndexEstimate {
  assetIds: string[];
  fileNames: string[];
  fileCount: number;
  remainingDurationMs: number;
  estimatedCredits: number;
}

interface MediaSearchState {
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

export const useMediaSearchStore = create<MediaSearchState>((set, get) => {
  let worker: Promise<void> | null = null;
  const pauseRequested = new Set<string>();

  const updateSnapshot = (snapshot: MediaSearchSnapshot) => set({ snapshot, loaded: true, loading: false });

  const reconcileRemoved = async (snapshot: MediaSearchSnapshot): Promise<MediaSearchSnapshot> => {
    if (snapshot.removedAssetIds.length === 0) return snapshot;
    const acknowledged: string[] = [];
    for (const assetId of snapshot.removedAssetIds) {
      try {
        await deleteMediaSearchAsset(snapshot.deviceId, assetId);
        acknowledged.push(assetId);
      } catch {
        // The durable on-device tombstone retries after the next load or scan.
      }
    }
    return acknowledged.length > 0 ? mediaSearchAcknowledgeRemovedAssets(acknowledged) : snapshot;
  };

  const scheduleWorker = () => {
    if (worker) return;
    worker = runWorker().finally(() => {
      worker = null;
      set({ indexingAssetId: null });
      if ((get().snapshot?.assets ?? []).some(isRunnableAsset)) scheduleWorker();
    });
  };

  const runWorker = async () => {
    while (true) {
      const asset = get().snapshot?.assets.find(isRunnableAsset);
      if (!asset) return;
      const totalChunks = mediaChunkCount(asset.durationMs);
      set({
        indexingAssetId: asset.assetId,
        progress: totalChunks > 0 ? asset.nextChunkIndex / totalChunks : 0,
        error: null,
      });
      try {
        for (let index = asset.nextChunkIndex; index < totalChunks; index += 1) {
          if (pauseRequested.has(asset.assetId) || currentAsset(asset.assetId)?.status === "paused") break;
          const chunk = await mediaSearchPrepareChunk(asset.assetId, index);
          await indexChunkWithRetry(chunk);
          const snapshot = await mediaSearchRecordChunk(asset.assetId, asset.fingerprint, index);
          updateSnapshot(snapshot);
          set({ progress: (index + 1) / totalChunks });
        }
        if (pauseRequested.delete(asset.assetId) || currentAsset(asset.assetId)?.status === "paused") {
          const snapshot = await mediaSearchSetAssetState(asset.assetId, "paused");
          updateSnapshot(snapshot);
          continue;
        }
        const latest = currentAsset(asset.assetId);
        if (latest && latest.nextChunkIndex >= totalChunks) {
          const snapshot = await mediaSearchComplete(asset.assetId, asset.fingerprint);
          clearSemanticExplorerSearchCache();
          updateSnapshot(snapshot);
          set({ progress: 1 });
        }
      } catch (reason) {
        try {
          const snapshot = await mediaSearchComplete(asset.assetId, asset.fingerprint, "index_failed");
          updateSnapshot(snapshot);
        } catch {
          // Preserve the original actionable error.
        }
        set({ error: errorText(reason) });
      }
    }
  };

  const currentAsset = (assetId: string) => get().snapshot?.assets.find((asset) => asset.assetId === assetId);

  return {
    loaded: false,
    loading: false,
    indexingAssetId: null,
    progress: 0,
    error: null,
    snapshot: null,
    pendingApproval: null,
    load: async () => {
      try {
        set({ loading: true, error: null });
        const snapshot = await reconcileRemoved(await ensureMediaSearchDeviceReady(await mediaSearchSnapshot()));
        updateSnapshot(snapshot);
        scheduleWorker();
      } catch (reason) {
        set({ loaded: true, loading: false, error: errorText(reason) });
      }
    },
    scan: async () => {
      try {
        set({ loading: true, error: null });
        const snapshot = await reconcileRemoved(await ensureMediaSearchDeviceReady(await mediaSearchScanMovies()));
        updateSnapshot(snapshot);
        scheduleWorker();
      } catch (reason) {
        set({ loading: false, error: errorText(reason) });
      }
    },
    requestIndex: (assetIds) => {
      const wanted = new Set(assetIds);
      const assets = (get().snapshot?.assets ?? []).filter((asset) => wanted.has(asset.assetId) && isEligibleAsset(asset));
      if (assets.length === 0) return;
      const estimate = estimateAssets(assets);
      set({ pendingApproval: estimate, error: null });
    },
    confirmIndex: async () => {
      const approval = get().pendingApproval;
      if (!approval) return;
      try {
        set({ loading: true, error: null });
        const snapshot = await mediaSearchApproveAssets(approval.assetIds);
        set({ snapshot, pendingApproval: null, loading: false });
        scheduleWorker();
      } catch (reason) {
        set({ loading: false, error: errorText(reason) });
      }
    },
    cancelIndexApproval: () => set({ pendingApproval: null }),
    pauseAsset: async (assetId) => {
      pauseRequested.add(assetId);
      const snapshot = await mediaSearchSetAssetState(assetId, "paused");
      updateSnapshot(snapshot);
    },
    resumeAsset: async (assetId) => {
      pauseRequested.delete(assetId);
      const snapshot = await mediaSearchSetAssetState(assetId, "queued");
      updateSnapshot(snapshot);
      scheduleWorker();
    },
    removeAssetIndex: async (assetId) => {
      const snapshot = get().snapshot;
      if (!snapshot) return;
      await deleteMediaSearchAsset(snapshot.deviceId, assetId);
      const updated = await mediaSearchSetAssetState(assetId, "reset");
      clearSemanticExplorerSearchCache();
      updateSnapshot(updated);
    },
    clearDeviceIndex: async () => {
      const snapshot = get().snapshot;
      if (!snapshot) return;
      await deleteMediaSearchDevice(snapshot.deviceId);
      const updated = await mediaSearchResetDeviceIndex();
      clearSemanticExplorerSearchCache();
      updateSnapshot(updated);
    },
  };
});

function isEligibleAsset(asset: MediaAsset): boolean {
  return asset.status !== "unsupported" && asset.indexedFingerprint !== asset.fingerprint;
}

function isRunnableAsset(asset: MediaAsset): boolean {
  return (asset.status === "queued" || asset.status === "processing")
    && asset.approvedFingerprint === asset.fingerprint
    && asset.indexedFingerprint !== asset.fingerprint;
}

export function estimateAssets(assets: MediaAsset[]): MediaIndexEstimate {
  let remainingDurationMs = 0;
  let estimatedCredits = 0;
  for (const asset of assets) {
    const startChunk = asset.approvedFingerprint === asset.fingerprint ? asset.nextChunkIndex : 0;
    for (let index = startChunk; index < mediaChunkCount(asset.durationMs); index += 1) {
      const start = index * 30_000;
      const end = index + 1 === mediaChunkCount(asset.durationMs) ? asset.durationMs : start + 30_000;
      const duration = Math.max(0, end - start);
      remainingDurationMs += duration;
      estimatedCredits += Math.max(1, Math.ceil(duration * 1000 / 60_000)) / 1000;
    }
  }
  return {
    assetIds: assets.map((asset) => asset.assetId),
    fileNames: assets.map((asset) => asset.name),
    fileCount: assets.length,
    remainingDurationMs,
    estimatedCredits: Math.round(estimatedCredits * 1000) / 1000,
  };
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function mediaChunkCount(durationMs: number): number {
  const full = Math.floor(durationMs / 30_000);
  const remainder = durationMs % 30_000;
  return remainder === 0 ? full : remainder < 5_000 && full > 0 ? full : full + 1;
}

async function indexChunkWithRetry(chunk: Parameters<typeof indexMediaChunk>[0]): Promise<void> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await indexMediaChunk(chunk);
      return;
    } catch (reason) {
      if (attempt === maxAttempts || !isRetryableChunkError(reason)) throw reason;
      const serverDelay = reason instanceof ManagedAiRequestError ? reason.retryAfterSeconds : undefined;
      const delayMs = Math.min(60_000, Math.max(500, (serverDelay ?? 2 ** (attempt - 1)) * 1000));
      await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
    }
  }
}

function isRetryableChunkError(reason: unknown): boolean {
  if (reason instanceof ManagedAiRequestError) {
    if (reason.code === "media_search_disabled" || reason.code === "insufficient_credits") return false;
    return reason.status === 409 || reason.status === 429 || reason.status === 502 || reason.status === 504;
  }
  return reason instanceof TypeError;
}
