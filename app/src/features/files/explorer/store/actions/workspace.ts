import { useMultiPanelStore } from "@/features/workspace";
import {
  clipboardSnapshot,
  explorerLibraryRecordLastOpened,
  explorerLibraryRecordRecent,
  explorerLibrarySnapshot,
} from "@/features/files/native";
import { errorText } from "@/shared/lib/format";
import type { ExplorerStore } from "../../model/interfaces/store/types";
import type { ExplorerGet, ExplorerSet } from "../../model/types/store/types";
import * as H from "../helpers";
import { explorerRuntime } from "../runtime";

export function createWorkspaceActions(set: ExplorerSet, get: ExplorerGet): Partial<ExplorerStore> {
  return {
    loadLibrary: async () => {
      try {
        set({ library: await explorerLibrarySnapshot() });
      } catch {
        // Library state is optional in browser/dev contexts and should not block Explorer startup.
      }
    },

    recordLibraryRecent: async (entry) => {
      try {
        set({ library: await explorerLibraryRecordRecent(H.libraryItemFromEntry(entry)) });
      } catch {
        // Best-effort parity with the native Recent library.
      }
    },

    recordLastOpenedPath: async (path) => {
      if (!path.trim()) return;
      if (get().library?.lastOpenedPath === path) return;
      try {
        set({ library: await explorerLibraryRecordLastOpened(path) });
      } catch {
        // Best-effort parity with the native last-opened path.
      }
    },

    initialize: async (homePath) => {
      const multi = useMultiPanelStore.getState();
      if (explorerRuntime.initializationInFlight) return;
      if (get().initialized) return;
      explorerRuntime.initializationInFlight = true;
      H.ensureDirectorySizeScheduler();
      void get().loadLibrary();
      try {
        try {
          const processClipboard = await clipboardSnapshot();
          const restoredClipboard = H.explorerClipboardFromPayload(processClipboard.local);
          set({ clipboard: restoredClipboard });
        } catch {
          // Best effort clipboard restore
        }
        if (multi.tabs.length === 0) {
          multi.initialize(homePath, H.titleFromPath(homePath));
        }
        set({ initialized: true });
        const currentMulti = useMultiPanelStore.getState();
        const activeTab =
          currentMulti.tabs.find((tab) => tab.id === currentMulti.activeTabId) ??
          currentMulti.tabs[0];
        const activePaneId =
          currentMulti.activePaneId || activeTab?.activePaneId || "explorer-pane-0";
        const panePath = activeTab?.panes.find((p) => p.id === activePaneId)?.path || homePath;
        try {
          await get().loadPane(activePaneId, panePath, "replace");
        } catch (error) {
          set({ operationError: `Could not open ${panePath}: ${errorText(error)}` });
        }
      } finally {
        explorerRuntime.initializationInFlight = false;
      }
    },
  };
}
