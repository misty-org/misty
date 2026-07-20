import type { ExplorerRuntime } from "@/models/interfaces/features/explorer/store/runtime";
export type { ExplorerRuntime } from "@/models/interfaces/features/explorer/store/runtime";
import type { StoreApi } from "zustand";
import type { NativeWorkspaceDocument } from "@/models/interfaces/services/misty-api";
import type { ExplorerStore } from "@/models/interfaces/features/explorer/store/types";

export const explorerRuntime: ExplorerRuntime = {
  workspaceDocumentCache: null,
  workspaceSaveTimer: null,
  initializationInFlight: false,
  transferRefreshObserverReady: false,
  transferRefreshWatermarkMs: 0,
  transferRefreshStatuses: {},
  nextExplorerNotificationId: 1,
  directorySizeSchedulerTimer: null,
  pendingPaneRefreshes: new Map(),
  paneLoadRequestsInFlight: new Map(),
  explorerWorkspaceResetKey: "misty.explorer.resetWorkspaceOnNextLoad.v1",
  directorySizeRefreshIntervalMs: 30 * 60 * 1000,
  store: null,
};

export function registerExplorerStore(store: StoreApi<ExplorerStore>): void {
  explorerRuntime.store = store;
}

export function getExplorerStore(): StoreApi<ExplorerStore> {
  if (!explorerRuntime.store) throw new Error("Explorer store has not been initialized.");
  return explorerRuntime.store;
}
