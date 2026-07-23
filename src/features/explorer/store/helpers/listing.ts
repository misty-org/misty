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

import type {
  NavigationMode,
  ExplorerDialogState,
  ExplorerNotificationType,
} from "@/models/types/features/explorer/store/types";
import type {
  ExplorerNotification,
  ExplorerStore,
  PaneExplorerState,
  ExplorerBatchRenameItem,
  ExplorerInlineEditState,
  ExplorerSortState,
} from "@/models/interfaces/features/explorer/store/types";
import { explorerRuntime, getExplorerStore } from "../runtime";
import * as H from "./index";

export function shouldShowLoadingSkeleton(pane: PaneExplorerState, path: string): boolean {
  const knownLocation = pane.needsLoad
    ? undefined
    : H.samePath(pane.listing?.path ?? "", path)
      ? pane.listing?.location
      : pane.listing?.entries.find((entry) => H.samePath(entry.path, path))?.location;
  if (knownLocation) return knownLocation.kind !== "local";
  if (path.startsWith("misty://")) return false;

  const environment = useAppStore.getState().app?.environment;
  if (!environment) return false;
  const settings = useSettingsStore.getState().settings?.document;
  const general = selectGeneralPreferences(settings);
  const advanced = selectAdvancedPreferences(settings);
  const preferredRoot = general.preferredWorkspaceRoot.trim();
  const storageHome =
    !preferredRoot || preferredRoot === "~"
      ? environment.homeDir
      : preferredRoot.startsWith("~/")
        ? `${environment.homeDir.replace(/\/+$/, "")}/${preferredRoot.slice(2)}`
        : preferredRoot.startsWith("/")
          ? preferredRoot
          : `${environment.homeDir.replace(/\/+$/, "")}/${preferredRoot}`;
  const mountRoot = H.resolveMountRoot(
    storageHome,
    advanced.mountPath || environment.mountPath || ".misty/mnt",
  );
  const target = H.normalizedPath(path);
  const mount = H.normalizedPath(mountRoot);
  return target === mount || target.startsWith(`${mount}/`);
}

export async function publishDesktopNotification(
  notification: ExplorerNotification,
  enabled: boolean,
): Promise<void> {
  if (!enabled || typeof Notification === "undefined") return;
  try {
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") return;
    const title =
      notification.type === "error"
        ? "Misty needs attention"
        : notification.type === "success"
          ? "Misty completed an action"
          : "Misty";
    new Notification(title, {
      body: notification.message,
      tag: `misty-${notification.id}`,
    });
  } catch {
    // Some webviews disable the Web Notification API; in-app Activity still records the event.
  }
}

export function playNotificationSound(type: ExplorerNotificationType): void {
  try {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = type === "error" ? 220 : type === "success" ? 660 : 440;
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
    window.setTimeout(() => void context.close(), 260);
  } catch {
    // Audio output can be unavailable or blocked until user interaction.
  }
}

export function applyNavigationResult(
  pane: PaneExplorerState,
  listing: DirectoryListing,
  mode: NavigationMode,
): PaneExplorerState {
  const previousPath = pane.listing?.path ?? "";
  const selectedIdsByPath = previousPath
    ? { ...pane.selectedIdsByPath, [previousPath]: pane.selectedIds }
    : { ...pane.selectedIdsByPath };
  let backHistory = [...pane.backHistory];
  let forwardHistory = [...pane.forwardHistory];

  if (mode === "push" && previousPath && !H.samePath(previousPath, listing.path)) {
    if (!H.samePath(backHistory[backHistory.length - 1] ?? "", previousPath))
      backHistory.push(previousPath);
    forwardHistory = [];
  } else if (mode === "back" && previousPath) {
    backHistory = backHistory.slice(0, -1);
    if (!H.samePath(forwardHistory[forwardHistory.length - 1] ?? "", previousPath))
      forwardHistory.push(previousPath);
  } else if (mode === "forward" && previousPath) {
    forwardHistory = forwardHistory.slice(0, -1);
    if (!H.samePath(backHistory[backHistory.length - 1] ?? "", previousPath))
      backHistory.push(previousPath);
  }

  const visibleIds = new Set(listing.entries.map((entry) => entry.id));
  const selectedIds = (selectedIdsByPath[listing.path] ?? []).filter((id) => visibleIds.has(id));
  return {
    ...pane,
    listing,
    hasFolderEntries: listing.entries.some((entry) => !entry.isDeleted && entry.kind === "folder"),
    selectedIds,
    selectedIdsByPath,
    backHistory,
    forwardHistory,
    loading: false,
    showLoadingSkeleton: false,
    error: null,
  };
}

export function directoryListingsEqual(left: DirectoryListing, right: DirectoryListing): boolean {
  if (left === right) return true;
  if (
    left.path !== right.path ||
    left.title !== right.title ||
    left.parentPath !== right.parentPath ||
    left.totalCount !== right.totalCount ||
    left.hiddenCount !== right.hiddenCount ||
    left.entries.length !== right.entries.length ||
    left.location.kind !== right.location.kind
  ) {
    return false;
  }
  if (left.location.kind === "remote" && right.location.kind === "remote") {
    if (
      left.location.remoteName !== right.location.remoteName ||
      left.location.remotePath !== right.location.remotePath ||
      left.location.providerType !== right.location.providerType
    ) {
      return false;
    }
  }
  return left.entries.every((entry, index) => H.fileEntriesEqual(entry, right.entries[index]));
}

export function fileEntriesEqual(left: FileEntry, right: FileEntry): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.name === right.name &&
      left.path === right.path &&
      left.kind === right.kind &&
      left.sizeBytes === right.sizeBytes &&
      left.modifiedMs === right.modifiedMs &&
      left.extension === right.extension &&
      left.mimeType === right.mimeType &&
      left.remoteModified === right.remoteModified &&
      left.location.kind === right.location.kind &&
      left.location.remoteName === right.location.remoteName &&
      left.location.remotePath === right.location.remotePath &&
      left.location.providerType === right.location.providerType)
  );
}

export function samePath(left: string, right: string): boolean {
  return H.normalizedPath(left) === H.normalizedPath(right);
}

export function normalizedPath(path: string): string {
  if (path.startsWith("misty://")) return path.replace(/\/+$/, "");
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
}

export function libraryItemFromEntry(entry: FileEntry): ExplorerLibraryItem {
  return {
    path: entry.path,
    name: entry.name,
    id: entry.id || entry.path,
    isDir: entry.kind === "folder",
    size: entry.sizeBytes ?? 0,
    lastModified:
      entry.remoteModified ?? (entry.modifiedMs ? new Date(entry.modifiedMs).toISOString() : ""),
    mimeType: entry.mimeType ?? "",
    type: entry.location.kind === "remote" ? 1 : 0,
  };
}

export function loadPinnedPaths(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem("misty.explorer.pinnedPaths") ?? "[]");
    const pinnedPaths = Array.isArray(parsed)
      ? H.normalizePinnedPaths(parsed.filter((value): value is string => typeof value === "string"))
      : [];
    window.localStorage.setItem("misty.explorer.pinnedPaths", JSON.stringify(pinnedPaths));
    return pinnedPaths;
  } catch {
    return [];
  }
}

export function normalizePinnedPaths(paths: string[]): string[] {
  const normalized: string[] = [];
  for (const path of paths) {
    const candidate = H.normalizedPath(path.trim());
    if (!candidate || normalized.some((existing) => H.samePath(existing, candidate))) continue;
    normalized.push(candidate);
  }
  return normalized;
}

export function scheduleExplorerWorkspaceSave(): void {
  if (!getExplorerStore().getState().initialized) return;
  if (explorerRuntime.workspaceSaveTimer !== null)
    window.clearTimeout(explorerRuntime.workspaceSaveTimer);
  explorerRuntime.workspaceSaveTimer = window.setTimeout(() => {
    explorerRuntime.workspaceSaveTimer = null;
    void H.persistExplorerWorkspace();
  }, 500);
}

export function queuePaneRefresh(
  paneId: string,
  path: string,
  options: { immediate?: boolean } = {},
): void {
  if (H.isExplorerInternalTabPath(path)) return;
  const key = `${paneId}\n${H.normalizedPath(path)}`;
  const pending = explorerRuntime.pendingPaneRefreshes.get(key) ?? {
    firstTimer: null,
    followupTimer: null,
  };
  explorerRuntime.pendingPaneRefreshes.set(key, pending);

  const refresh = () => {
    const pane = getExplorerStore().getState().panes[paneId];
    if (pane?.listing?.path === path && !pane.loading) {
      void getExplorerStore().getState().loadPane(paneId, path, "replace");
    }
  };

  const clearIfIdle = () => {
    const current = explorerRuntime.pendingPaneRefreshes.get(key);
    if (current && current.firstTimer === null && current.followupTimer === null) {
      explorerRuntime.pendingPaneRefreshes.delete(key);
    }
  };

  if (options.immediate) {
    if (pending.firstTimer !== null) {
      window.clearTimeout(pending.firstTimer);
      pending.firstTimer = null;
    }
    refresh();
  } else if (pending.firstTimer === null) {
    pending.firstTimer = window.setTimeout(() => {
      pending.firstTimer = null;
      refresh();
      clearIfIdle();
    }, 650);
  }

  if (pending.followupTimer === null) {
    pending.followupTimer = window.setTimeout(() => {
      pending.followupTimer = null;
      refresh();
      clearIfIdle();
    }, 2200);
  }
}

export function transferTouchesDirectory(
  row: TransferRecord,
  directoryPath: string,
  mountRoot: string,
): boolean {
  const remote = H.remoteBrowseTargetForPath(directoryPath, mountRoot);
  if (remote) {
    return (
      H.remoteTransferMatchesDirectory(remote, row.remoteSourceName, row.remoteSourcePath) ||
      H.remoteTransferMatchesDirectory(remote, row.remoteDestName, row.remoteDestPath)
    );
  }
  return (
    H.localTransferMatchesDirectory(directoryPath, row.localSourcePath) ||
    H.localTransferMatchesDirectory(directoryPath, row.localDestPath)
  );
}

export function localTransferMatchesDirectory(
  directoryPath: string,
  candidatePath: string,
): boolean {
  if (!directoryPath || !candidatePath) return false;
  return H.normalizedPath(directoryPath) === H.parentDirectory(candidatePath);
}

export function remoteTransferMatchesDirectory(
  current: { remoteName: string; remotePath: string },
  remoteName: string,
  remotePath: string,
): boolean {
  if (!remoteName || current.remoteName !== remoteName || !remotePath) return false;
  return H.normalizedPath(current.remotePath) === H.remoteParentDirectory(remotePath);
}

export function remoteBrowseTargetForPath(
  path: string,
  mountRoot: string,
): { remoteName: string; remotePath: string } | null {
  const cleanPath = H.normalizedPath(path);
  const cleanMount = H.normalizedPath(mountRoot);
  if (cleanPath !== cleanMount && !cleanPath.startsWith(`${cleanMount}/`)) return null;
  const parts = cleanPath.slice(cleanMount.length).split("/").filter(Boolean);
  if (parts.length < 1) return null;
  return {
    remoteName: parts[0],
    remotePath: parts.length > 1 ? `/${parts.slice(1).join("/")}` : "/",
  };
}

export function parentDirectory(path: string): string {
  const normalized = H.normalizedPath(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return "/";
  return normalized.slice(0, slash);
}

export function remoteParentDirectory(path: string): string {
  const parent = H.parentDirectory(path);
  return parent === "/" ? "" : parent;
}

export function setPreviewVisibleForPane(paneId: string): void {
  const multi = useMultiPanelStore.getState();
  const tab = multi.tabs.find((candidate) => candidate.panes.some((pane) => pane.id === paneId));
  if (tab) multi.setTabPanelVisibility(tab.id, { previewVisible: true });
}
