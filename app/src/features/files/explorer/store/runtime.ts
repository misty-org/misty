import type { NativeWorkspaceDocument } from "@/native/contracts";
import type { StoreApi } from "zustand";
import type { ExplorerStore } from "../model/interfaces/store/types";

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
