import {
  clipboardSetLocal,
  explorerPathIsDirectory,
  explorerQueuePasteItems,
  transfersSnapshot,
} from "@/features/files/native";
import { errorText, userFacingErrorText } from "@/shared/lib/format";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import type { ExplorerStore } from "../../model/interfaces/store/types";
import type { ExplorerGet, ExplorerSet } from "../../model/types/store/types";
import * as H from "../helpers";
import { explorerRuntime } from "../runtime";

export function createClipboardActions(set: ExplorerSet, get: ExplorerGet): Partial<ExplorerStore> {
  return {
    copySelected: (paneId) => {
      const pane = get().panes[paneId];
      const items = H.selectedPasteItemsForPane(pane);
      if (items.length === 0) return;
      set({ clipboard: { items, operation: "copy" }, operationError: null });
      void clipboardSetLocal(H.clipboardPayloadForPane(pane)).catch((error) => {
        set({ operationError: `Clipboard update failed: ${errorText(error)}` });
      });
      void H.writeNativeOrTextClipboardForSelection(pane).catch(() => undefined);
    },

    cutSelected: (paneId) => {
      const pane = get().panes[paneId];
      const items = H.selectedPasteItemsForPane(pane);
      if (items.length === 0) return;
      set({ clipboard: { items, operation: "move" }, operationError: null });
    },

    pasteIntoPane: async (paneId) => {
      const pane = get().panes[paneId];
      const directory = pane?.listing?.path;
      const clipboard = get().clipboard;
      if (!directory) return;

      try {
        set({ operationError: null });
        if (clipboard?.operation === "move" && clipboard.items.length > 0) {
          await explorerQueuePasteItems({
            sources: clipboard.items,
            destinationDirectory: directory,
            operation: clipboard.operation,
          });
          H.refreshTransferViews();
          get().pushNotification(
            `Queued move for ${H.itemCountLabel(clipboard.items.length)}`,
            "success",
          );
          set({ clipboard: null });
          H.queuePaneRefresh(paneId, directory);
          return;
        }

        if (await H.pasteSystemClipboardTextIntoPane(paneId, directory)) {
          return;
        }

        if (!clipboard?.items.length) return;
        await explorerQueuePasteItems({
          sources: clipboard.items,
          destinationDirectory: directory,
          operation: clipboard.operation,
        });
        H.refreshTransferViews();
        get().pushNotification(
          `Queued copy for ${H.itemCountLabel(clipboard.items.length)}`,
          "success",
        );
        H.queuePaneRefresh(paneId, directory);
      } catch (error) {
        set({ operationError: userFacingErrorText(error) });
      }
    },

    uploadIntoPane: async (paneId, sourceKind = "files") => {
      const directory = get().panes[paneId]?.listing?.path;
      if (!directory) return;
      if (!hasTauriInternals()) {
        set({ operationError: "Uploading local files is only available in the Misty app." });
        return;
      }
      try {
        const selection = await open({ multiple: true, directory: sourceKind === "folders" });
        const paths = selection == null ? [] : Array.isArray(selection) ? selection : [selection];
        if (paths.length === 0) return;
        set({ operationError: null });
        await explorerQueuePasteItems({
          sources: paths.map((path) => ({ path, isDirectory: sourceKind === "folders" })),
          destinationDirectory: directory,
          operation: "copy",
        });
        H.refreshTransferViews();
        get().pushNotification(`Queued upload for ${H.itemCountLabel(paths.length)}`, "success");
        H.queuePaneRefresh(paneId, directory);
      } catch (error) {
        set({ operationError: `Upload failed: ${userFacingErrorText(error)}` });
      }
    },

    dropItems: async (paneId, items, destination, operation) => {
      if (items.length === 0 || !destination) return;
      try {
        set({ operationError: null });
        await explorerQueuePasteItems({
          sources: items,
          destinationDirectory: destination,
          operation,
        });
        H.refreshTransferViews();
        get().pushNotification(
          `Queued ${operation === "move" ? "move" : "copy"} for ${H.itemCountLabel(items.length)}`,
          "success",
        );
        const current = get().panes[paneId]?.listing?.path;
        if (current) H.queuePaneRefresh(paneId, current);
      } catch (error) {
        set({ operationError: `Drop failed: ${userFacingErrorText(error)}` });
      }
    },

    dropExternalPaths: async (paneId, paths, destination) => {
      const cleanPaths = paths.filter(Boolean);
      if (cleanPaths.length === 0 || !destination) return;
      try {
        set({ operationError: null });
        const sources = await Promise.all(
          cleanPaths.map(async (path) => ({
            path,
            isDirectory: await explorerPathIsDirectory(path),
          })),
        );
        await explorerQueuePasteItems({
          sources,
          destinationDirectory: destination,
          operation: "copy",
        });
        H.refreshTransferViews();
        get().pushNotification(`Queued drop for ${H.itemCountLabel(sources.length)}`, "success");
        const current = get().panes[paneId]?.listing?.path;
        if (current) H.queuePaneRefresh(paneId, current);
      } catch (error) {
        set({ operationError: `Drop failed: ${userFacingErrorText(error)}` });
      }
    },

    pollTransferRefreshes: async (mountRoot) => {
      try {
        if (Object.values(get().panes).every((pane) => !pane.listing)) return;
        const page = await transfersSnapshot({ limit: 50 });
        const completedRows = page.rows.filter((row) => row.status === "completed");
        if (!explorerRuntime.transferRefreshObserverReady) {
          explorerRuntime.transferRefreshObserverReady = true;
          explorerRuntime.transferRefreshWatermarkMs = Math.max(
            0,
            ...completedRows.map((row) => row.completedAtMs),
          );
          explorerRuntime.transferRefreshStatuses = Object.fromEntries(
            page.rows.map((row) => [row.id, row.status]),
          );
          return;
        }

        const previousStatuses = explorerRuntime.transferRefreshStatuses;
        explorerRuntime.transferRefreshStatuses = Object.fromEntries(
          page.rows.map((row) => [row.id, row.status]),
        );
        const newlyCompleted = completedRows.filter((row) => {
          const previousStatus = previousStatuses[row.id];
          return (
            previousStatus !== "completed" ||
            row.completedAtMs > explorerRuntime.transferRefreshWatermarkMs
          );
        });
        if (newlyCompleted.length === 0) return;
        explorerRuntime.transferRefreshWatermarkMs = Math.max(
          explorerRuntime.transferRefreshWatermarkMs,
          ...newlyCompleted.map((row) => row.completedAtMs),
        );

        const panes = get().panes;
        for (const [paneId, pane] of Object.entries(panes)) {
          const currentPath = pane.listing?.path;
          if (!currentPath) continue;
          if (
            newlyCompleted.some((row) => H.transferTouchesDirectory(row, currentPath, mountRoot))
          ) {
            H.queuePaneRefresh(paneId, currentPath, { immediate: true });
          }
        }
      } catch {
        // Transfer refresh is opportunistic; the Transfers view still owns visible transfer errors.
      }
    },
  };
}
