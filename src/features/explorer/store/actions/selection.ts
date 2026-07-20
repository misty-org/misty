import { create } from "zustand";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { hasTauriInternals } from "@/platform/tauri";
import { isAndroidBuild, isNativeMobileBuild } from "@/platform/buildTarget";
import { useAppStore } from "@/stores/app";
import {
  clipboardNativeFileRefs,
  explorerCalculateDirectorySizes,
  explorerDirectorySizeSnapshot,
  clipboardSetLocal,
  clipboardSnapshot,
  clipboardWriteFileRefs,
  explorerListDirectory,
  explorerLibraryRecordLastOpened,
  explorerLibraryRecordRecent,
  explorerLibrarySnapshot,
  explorerOpenAssociation,
  explorerOpenPath,
  explorerSetOpenAssociation,
  explorerOpenWith,
  explorerPathExists,
  explorerPathIsDirectory,
  explorerPrepareDragItems,
  explorerPrepareOpenItem,
  explorerQueuePasteBlob,
  explorerQueueCreateItem,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  explorerQueuePasteText,
  explorerQueueRenameItem,
  explorerQueueRenameItems,
  transfersSnapshot,
  workspacesSave,
  workspacesSnapshot,
} from "@/stores/backend";
import type { ClipboardOperation, CreateItemKind } from "@/models/types/services/misty-api";
import type {
  ClipboardPayload,
  DirectorySizeRecord,
  DirectoryListing,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  FileEntry,
  NativeWorkspace,
  NativeWorkspaceDocument,
  NativeWorkspaceExplorerSnapshot,
  PasteItem,
  PreparedOpenItem,
  TransferRecord,
} from "@/models/interfaces/services/misty-api";
import { errorText, userFacingErrorText } from "@/lib/format";
import { useMultiPanelStore } from "@/features/workspace";
import type {
  MultiPanelClosedPane,
  MultiPanelPane,
  MultiPanelTab,
} from "@/models/interfaces/workspace";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  selectNotificationPreferences,
  useSettingsStore,
} from "@/stores/app";
import { useOperationQueueStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import { clipboardImagePng } from "../../utils/clipboardImage";
import { publishCloudFolderBotNotification } from "@/features/bots/cloudFolderBot";
import type { ExplorerGet, ExplorerSet } from "@/models/types/features/explorer/store/types";
import type { ExplorerStore } from "@/models/interfaces/features/explorer/store/types";
import { explorerRuntime, getExplorerStore } from "../runtime";
import * as H from "../helpers";

export function createSelectionActions(set: ExplorerSet, get: ExplorerGet): Partial<ExplorerStore> {
  return {
    selectEntry: (paneId, entryId, options = {}) => {
      set((state) => {
        const pane = state.panes[paneId] ?? H.emptyPaneState();
        const entries = pane.listing?.entries ?? [];
        const path = pane.listing?.path ?? "";
        const entryIndex = entries.findIndex((entry) => entry.id === entryId);
        let selectedIds: string[];
        if (options.range && pane.listing && entryIndex >= 0 && options.visibleEntryIds?.length) {
          const entryIds = new Set(entries.map((entry) => entry.id));
          const visibleEntryIds = options.visibleEntryIds.filter((id) => entryIds.has(id));
          const targetVisibleIndex = visibleEntryIds.indexOf(entryId);
          const previousAnchor = pane.lastSelectedIndexByPath[path];
          const anchorEntryId =
            previousAnchor === undefined ? entryId : entries[previousAnchor]?.id;
          const anchorVisibleIndex = anchorEntryId ? visibleEntryIds.indexOf(anchorEntryId) : -1;
          const anchor = anchorVisibleIndex >= 0 ? anchorVisibleIndex : targetVisibleIndex;
          const target = targetVisibleIndex >= 0 ? targetVisibleIndex : anchor;
          const start = Math.min(anchor, target);
          const end = Math.max(anchor, target);
          selectedIds = visibleEntryIds.slice(start, end + 1);
        } else if (options.range && pane.listing && entryIndex >= 0) {
          const anchor = pane.lastSelectedIndexByPath[path] ?? entryIndex;
          const start = Math.min(anchor, entryIndex);
          const end = Math.max(anchor, entryIndex);
          selectedIds = entries.slice(start, end + 1).map((entry) => entry.id);
        } else if (options.toggle) {
          selectedIds = pane.selectedIds.includes(entryId)
            ? pane.selectedIds.filter((id) => id !== entryId)
            : [...pane.selectedIds, entryId];
        } else {
          selectedIds = [entryId];
        }
        const previousAnchor = pane.lastSelectedIndexByPath[path];
        const nextLastSelectedIndexByPath =
          entryIndex >= 0 && previousAnchor !== entryIndex
            ? { ...pane.lastSelectedIndexByPath, [path]: entryIndex }
            : pane.lastSelectedIndexByPath;
        if (
          H.arraysEqual(pane.selectedIds, selectedIds) &&
          H.arraysEqual(pane.selectedIdsByPath[path] ?? [], selectedIds) &&
          nextLastSelectedIndexByPath === pane.lastSelectedIndexByPath
        ) {
          return state;
        }
        const panes = {
          ...state.panes,
          [paneId]: {
            ...pane,
            selectedIds,
            selectedIdsByPath: { ...pane.selectedIdsByPath, [path]: selectedIds },
            lastSelectedIndexByPath: nextLastSelectedIndexByPath,
          },
        };
        return {
          panes,
          inlineEdit: H.syncInlineRenameSelection(state.inlineEdit, panes, paneId, entryId),
        };
      });
    },

    clearSelection: (paneId) => {
      set((state) => {
        const pane = state.panes[paneId];
        if (!pane) return state;
        if (pane.selectedIds.length === 0) return state;
        const path = pane.listing?.path ?? "";
        const panes = {
          ...state.panes,
          [paneId]: {
            ...pane,
            selectedIds: [],
            selectedIdsByPath: { ...pane.selectedIdsByPath, [path]: [] },
          },
        };
        return {
          panes,
          inlineEdit: H.syncInlineRenameSelection(state.inlineEdit, panes),
        };
      });
    },

    openEntry: async (paneId, entry) => {
      if (entry.isDeleted) {
        set({
          operationError:
            "Trash items are deleted cache entries and cannot be opened from here yet.",
        });
        return;
      }
      if (entry.kind === "folder") {
        void get().recordLibraryRecent(entry);
        await get().loadPane(paneId, entry.path);
        return;
      }
      if (entry.kind === "symlink") {
        try {
          if (await explorerPathIsDirectory(entry.path)) {
            void get().recordLibraryRecent(entry);
            await get().loadPane(paneId, entry.path);
            return;
          }
        } catch (error) {
          set({ operationError: `Unable to inspect link: ${userFacingErrorText(error)}` });
          return;
        }
      }
      get().selectEntry(paneId, entry.id);
      const defaultFileAction = selectGeneralPreferences(
        useSettingsStore.getState().settings?.document,
      ).defaultFileActionIndex;
      const isRemoteFile = entry.location.kind !== "local";
      if (!isRemoteFile && (defaultFileAction === 1 || defaultFileAction === 2)) {
        H.setPreviewVisibleForPane(paneId);
        set({ operationError: null });
        if (defaultFileAction === 1) {
          get().pushNotification("Preview opened", "info", 1800, false);
        }
        return;
      }
      try {
        set({ operationError: null });
        const prepared = await H.preparedOpenItemForEntry(entry);
        const localPath = prepared.localPath;
        const applicationPath = await H.associationForPath(entry.path);
        if (applicationPath) {
          await explorerOpenWith(applicationPath, localPath);
        } else {
          await explorerOpenPath(localPath);
        }
        if (isRemoteFile) {
          const cacheHit = prepared.cacheHit ?? prepared.cached;
          get().pushNotification(
            cacheHit ? `Opened ${entry.name} from cache` : `Downloaded ${entry.name}`,
            cacheHit ? "info" : "success",
            2200,
            false,
          );
        }
        void get().recordLibraryRecent(entry);
      } catch (error) {
        set({ operationError: `Unable to open file: ${userFacingErrorText(error)}` });
      }
    },

    openWithSelected: async (paneId) => {
      const entry = H.selectedEntryForPane(get().panes[paneId]);
      if (!entry || entry.kind === "folder" || entry.kind === "symlink") return;
      if (isNativeMobileBuild) {
        set({ operationError: "This file action is not available on this device." });
        return;
      }
      if (!hasTauriInternals()) {
        set({ operationError: "Choosing a local application is only available in the Misty app." });
        return;
      }
      try {
        const selection = await open({
          title: ["Choose", "Application"].join(" "),
          multiple: false,
          directory: false,
        });
        const applicationPath = Array.isArray(selection) ? selection[0] : selection;
        if (!applicationPath) return;
        set({ operationError: null });
        await H.setAssociationForPath(entry.path, applicationPath);
        await explorerOpenWith(applicationPath, await H.localPathForEntry(entry));
      } catch (error) {
        set({ operationError: `Open With failed: ${userFacingErrorText(error)}` });
      }
    },
  };
}
