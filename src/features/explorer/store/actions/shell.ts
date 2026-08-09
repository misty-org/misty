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
import { useActivityStore } from "@/features/activity";
import { clipboardImagePng } from "../../utils/clipboardImage";
import type { ExplorerGet, ExplorerSet } from "@/models/types/features/explorer/store/types";
import type { ExplorerStore } from "@/models/interfaces/features/explorer/store/types";
import { explorerRuntime, getExplorerStore } from "../runtime";
import * as H from "../helpers";

export function createShellActions(set: ExplorerSet, get: ExplorerGet): Partial<ExplorerStore> {
  return {
    togglePinnedPath: (path) => {
      const normalized = H.normalizedPath(path);
      const current = H.normalizePinnedPaths(get().pinnedPaths);
      const pinnedPaths = current.some((candidate) => H.samePath(candidate, normalized))
        ? current.filter((candidate) => !H.samePath(candidate, normalized))
        : H.normalizePinnedPaths([...current, normalized]);
      if (H.arraysEqual(current, pinnedPaths)) return;
      window.localStorage.setItem("misty.explorer.pinnedPaths", JSON.stringify(pinnedPaths));
      set({ pinnedPaths });
    },

    copyPath: async (path) => {
      try {
        await writeText(path);
        set({ operationError: null });
        get().pushNotification("Copied path", "info");
      } catch (error) {
        set({ operationError: errorText(error) });
      }
    },

    openContextMenu: (paneId, x, y, entryId = null) => {
      const currentState = get();
      if (entryId && !currentState.panes[paneId]?.selectedIds.includes(entryId)) {
        currentState.selectEntry(paneId, entryId);
      }
      set((state) => {
        const current = state.contextMenu;
        if (
          current.open &&
          current.x === x &&
          current.y === y &&
          current.paneId === paneId &&
          current.entryId === entryId
        ) {
          return state;
        }
        return { contextMenu: { open: true, x, y, paneId, entryId } };
      });
    },

    closeContextMenu: () => {
      set((state) =>
        state.contextMenu.open
          ? { contextMenu: { open: false, x: 0, y: 0, paneId: "", entryId: null } }
          : state,
      );
    },

    setSidebarVisible: (sidebarVisible) =>
      set((state) => (state.sidebarVisible === sidebarVisible ? state : { sidebarVisible })),
    setPreviewVisible: (previewVisible) =>
      set((state) => (state.previewVisible === previewVisible ? state : { previewVisible })),
    setSidebarWidth: (sidebarWidth) =>
      set((state) => {
        const width = Math.round(sidebarWidth);
        return state.sidebarWidth === width ? state : { sidebarWidth: width };
      }),
    setPreviewWidth: (previewWidth) =>
      set((state) => {
        const width = Math.round(previewWidth);
        return state.previewWidth === width ? state : { previewWidth: width };
      }),
    consumeOperationError: () => {
      const message = get().operationError;
      if (message) set({ operationError: null });
      return message;
    },
    pushNotification: (message, type = "info", durationMs = 3000, showInActivity = true) => {
      const trimmed = message.trim();
      if (!trimmed) return 0;
      const notificationPreferences = selectNotificationPreferences(
        useSettingsStore.getState().settings?.document,
      );
      const quietSuppressed = notificationPreferences.quietHoursEnabled && type !== "error";
      const digestSuppressed =
        notificationPreferences.digestNotificationsEnabled && type !== "error";
      const alertSuppressed = quietSuppressed || digestSuppressed;
      const showToast = notificationPreferences.inAppNotificationsEnabled && !alertSuppressed;
      const recordActivity = showInActivity;
      const id = explorerRuntime.nextExplorerNotificationId++;
      const notification = {
        id,
        message: trimmed,
        type,
        createdAtMs: Date.now(),
        read: alertSuppressed,
        showInActivity: recordActivity,
      };
      set((state) => ({
        notifications: showToast
          ? [...state.notifications, notification].slice(-3)
          : state.notifications,
        notificationHistory: recordActivity
          ? [...state.notificationHistory, notification].slice(-200)
          : state.notificationHistory,
      }));
      if (recordActivity) {
        useActivityStore.getState().ingestLocal({
          id: `explorer-${id}`,
          kind: type === "error" ? "failure" : type === "success" ? "completion" : "system",
          title:
            type === "error"
              ? "Misty needs attention"
              : type === "success"
                ? "Misty completed an action"
                : "Misty activity",
          body: trimmed,
          attention: type === "error",
          target: /transfer|upload|download|copy|move/i.test(trimmed)
            ? { kind: "workspace-tool", tool: "transfers" }
            : { kind: "workspace-tool", tool: "files" },
          notify: true,
        });
      }
      if (showToast && durationMs > 0) {
        window.setTimeout(() => {
          getExplorerStore().getState().dismissNotification(id);
        }, durationMs);
      }
      return id;
    },
    recordActivity: (message, type = "info") => {
      const trimmed = message.trim();
      if (!trimmed) return 0;
      const id = explorerRuntime.nextExplorerNotificationId++;
      const notification = {
        id,
        message: trimmed,
        type,
        createdAtMs: Date.now(),
        read: false,
        showInActivity: true,
      };
      set((state) => ({
        notificationHistory: [...state.notificationHistory, notification].slice(-200),
      }));
      useActivityStore.getState().ingestLocal({
        id: `explorer-${id}`,
        kind: type === "error" ? "failure" : type === "success" ? "completion" : "system",
        title: type === "error" ? "Misty needs attention" : "Misty activity",
        body: trimmed,
        attention: type === "error",
        target: /transfer|upload|download|copy|move/i.test(trimmed)
          ? { kind: "workspace-tool", tool: "transfers" }
          : { kind: "workspace-tool", tool: "files" },
        notify: true,
      });
      return id;
    },
    dismissNotification: (id) =>
      set((state) => ({
        notifications: state.notifications.filter((notification) => notification.id !== id),
      })),
    markNotificationsRead: () =>
      set((state) => ({
        notificationHistory: state.notificationHistory.map((notification) =>
          notification.read ? notification : { ...notification, read: true },
        ),
      })),
    clearNotificationHistory: () => set({ notificationHistory: [] }),
  };
}
