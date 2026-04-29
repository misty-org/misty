import type { NativeWorkspaceDocument } from "@/services/misty/model/misty-api";
import type { StoreApi } from "zustand";
import type { ExplorerStore } from "./types";

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
