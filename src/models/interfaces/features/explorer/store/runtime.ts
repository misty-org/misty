import type { StoreApi } from "zustand";
import type { NativeWorkspaceDocument } from "@/models/interfaces/services/misty-api";
import type { ExplorerStore } from "@/models/interfaces/features/explorer/store/types";

export interface ExplorerRuntime {
  workspaceDocumentCache: NativeWorkspaceDocument | null;
  workspaceSaveTimer: number | null;
  initializationInFlight: boolean;
  transferRefreshObserverReady: boolean;
  transferRefreshWatermarkMs: number;
  transferRefreshStatuses: Record<number, string>;
  nextExplorerNotificationId: number;
  directorySizeSchedulerTimer: number | null;
  pendingPaneRefreshes: Map<string, { firstTimer: number | null; followupTimer: number | null }>;
  paneLoadRequestsInFlight: Map<string, Promise<void>>;
  explorerWorkspaceResetKey: string;
  directorySizeRefreshIntervalMs: number;
  store: StoreApi<ExplorerStore> | null;
}
