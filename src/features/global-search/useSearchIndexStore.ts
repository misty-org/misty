import { create } from "zustand";
import {
  searchInit,
  searchGetStatus,
  searchStartScan,
  searchCancelScan,
} from "@/native/filesystem";
import type { SearchStatus } from "@/native/contracts";
import { selectSearchMaintenancePreferences, useSettingsStore } from "@/features/settings";
import { userFacingErrorText } from "@/shared/lib/format";

/** Native index lifecycle shared by global search and settings, independent of Files. */
export const useSearchIndexStore = create<{
  status: SearchStatus | null;
  error: string | null;
  initialize(): Promise<void>;
  refreshStatus(): Promise<void>;
  startScan(path: string): Promise<void>;
  cancelScan(): Promise<void>;
}>((set) => {
  const update = async (operation: () => Promise<SearchStatus>) => {
    try {
      set({ status: await operation(), error: null });
    } catch (error) {
      set({ error: userFacingErrorText(error) });
    }
  };
  return {
    status: null,
    error: null,
    initialize: () => update(searchInit),
    refreshStatus: () => update(searchGetStatus),
    startScan: () =>
      update(() => {
        const preferences = selectSearchMaintenancePreferences(
          useSettingsStore.getState().settings?.document,
        );
        return searchStartScan({
          includeLocal: true,
          includeRemotes: true,
          roots: [],
          maxDepth: preferences.maxDepth,
          ignoredPaths: preferences.ignoredPaths,
          incremental: true,
        });
      }),
    cancelScan: () => update(searchCancelScan),
  };
});
