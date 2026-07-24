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
  ExplorerDialogState,
  ExplorerNotificationType,
} from "@/models/types/features/explorer/store/types";
import type {
  ExplorerClipboardState,
  ExplorerStore,
  PaneExplorerState,
  ExplorerBatchRenameItem,
  ExplorerInlineEditState,
  ExplorerSortState,
} from "@/models/interfaces/features/explorer/store/types";
import { explorerRuntime, getExplorerStore } from "../runtime";
import * as H from "./index";

export async function localPathForEntry(entry: FileEntry): Promise<string> {
  return (await H.preparedOpenItemForEntry(entry)).localPath;
}

export async function preparedOpenItemForEntry(entry: FileEntry): Promise<PreparedOpenItem> {
  if (entry.location.kind === "local") {
    return {
      localPath: entry.path,
      cached: true,
      sourcePath: null,
      cachePath: null,
      cacheHit: true,
    };
  }
  return explorerPrepareOpenItem({
    path: entry.path,
    sizeBytes: entry.sizeBytes,
    remoteModified: entry.remoteModified,
  });
}

export async function associationForPath(filePath: string): Promise<string | null> {
  return explorerOpenAssociation(filePath);
}

export async function setAssociationForPath(
  filePath: string,
  applicationPath: string,
): Promise<void> {
  await explorerSetOpenAssociation(filePath, applicationPath);
}

export async function pasteSystemClipboardTextIntoPane(
  paneId: string,
  directory: string,
): Promise<boolean> {
  const nativeFileRefs = await H.readNativeClipboardFileRefs();
  if (nativeFileRefs.length > 0) {
    await explorerQueuePasteItems({
      sources: nativeFileRefs,
      destinationDirectory: directory,
      operation: "copy",
    });
    H.refreshTransferViews();
    H.queuePaneRefresh(paneId, directory);
    return true;
  }

  const uriListItems = await H.readClipboardUriListPasteItems();
  if (uriListItems.length > 0) {
    await explorerQueuePasteItems({
      sources: uriListItems,
      destinationDirectory: directory,
      operation: "copy",
    });
    H.refreshTransferViews();
    H.queuePaneRefresh(paneId, directory);
    return true;
  }

  const html = await H.readClipboardHtml();
  if (html?.trim()) {
    await explorerQueuePasteText({
      destinationDirectory: directory,
      text: html,
      preferredName: "clipboard.html",
    });
    H.refreshTransferViews();
    H.queuePaneRefresh(paneId, directory);
    return true;
  }

  const text = await readText().catch(() => "");
  if (text) {
    const pathItems = await H.pasteItemsFromClipboardText(text);
    if (pathItems.length > 0) {
      await explorerQueuePasteItems({
        sources: pathItems,
        destinationDirectory: directory,
        operation: "copy",
      });
      H.refreshTransferViews();
      H.queuePaneRefresh(paneId, directory);
      return true;
    }
    if (text.trim().length > 0) {
      await explorerQueuePasteText({
        destinationDirectory: directory,
        text,
        preferredName: "clipboard.txt",
      });
      H.refreshTransferViews();
      H.queuePaneRefresh(paneId, directory);
      return true;
    }
  }
  return H.pasteSystemClipboardImageIntoPane(paneId, directory);
}

export async function readNativeClipboardFileRefs(): Promise<PasteItem[]> {
  try {
    return await clipboardNativeFileRefs();
  } catch {
    return [];
  }
}

export async function readClipboardUriListPasteItems(): Promise<PasteItem[]> {
  if (!navigator.clipboard?.read) return [];
  try {
    const items = await navigator.clipboard.read();
    const paths: string[] = [];
    for (const item of items) {
      if (!item.types.includes("text/uri-list")) continue;
      const blob = await item.getType("text/uri-list");
      paths.push(...H.filePathsFromUriList(await blob.text()));
    }
    if (paths.length === 0) return [];
    return await H.pasteItemsFromClipboardPaths(paths);
  } catch {
    return [];
  }
}

export function filePathsFromUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(H.filePathFromFileUri)
    .filter((path): path is string => Boolean(path));
}

export function filePathFromFileUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    const path = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== "localhost") {
      return `//${url.hostname}${path}`;
    }
    return path.replace(/^\/([a-zA-Z]:[\\/])/, "$1");
  } catch {
    return null;
  }
}

export async function readClipboardHtml(): Promise<string | null> {
  if (!navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (!item.types.includes("text/html")) continue;
      const blob = await item.getType("text/html");
      return await blob.text();
    }
  } catch {
    return null;
  }
  return null;
}

export async function pasteSystemClipboardImageIntoPane(
  paneId: string,
  directory: string,
): Promise<boolean> {
  const image = await clipboardImagePng();
  if (!image) return false;
  await explorerQueuePasteBlob({
    destinationDirectory: directory,
    bytes: [...image.bytes],
    preferredName: "clipboard.png",
  });
  H.refreshTransferViews();
  H.queuePaneRefresh(paneId, directory);
  return true;
}

export async function pasteItemsFromClipboardText(text: string): Promise<PasteItem[]> {
  const paths = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (paths.length === 0 || paths.some((path) => !H.looksLikeClipboardPath(path))) {
    return [];
  }
  return H.pasteItemsFromClipboardPaths(paths);
}

export async function pasteItemsFromClipboardPaths(paths: string[]): Promise<PasteItem[]> {
  try {
    const items = await Promise.all(
      paths.map(async (path) => {
        if (!(await explorerPathExists(path))) return null;
        return {
          path,
          isDirectory: await explorerPathIsDirectory(path),
        };
      }),
    );
    return items.every((item): item is PasteItem => item !== null) ? items : [];
  } catch {
    return [];
  }
}

export function looksLikeClipboardPath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
}

export function clipboardPayloadForPane(pane: PaneExplorerState | undefined): ClipboardPayload {
  const selected = new Set(pane?.selectedIds ?? []);
  const entries = pane?.listing?.entries.filter((entry) => selected.has(entry.id)) ?? [];
  return {
    kind: entries.length > 0 ? "file_refs" : "empty",
    origin: "local_misty",
    payload_id: "",
    source_device_id: "",
    source_device_name: "",
    revision: 0,
    created_unix_ms: 0,
    text: "",
    html: "",
    file_refs: entries.map((entry) => ({
      display_name: entry.name,
      local_path: entry.location.kind === "local" ? entry.path : "",
      provider_type: entry.location.providerType ?? "",
      remote_name: entry.location.remoteName ?? "",
      remote_path: entry.location.remotePath ?? "",
      is_dir: entry.kind === "folder",
    })),
    images: [],
  };
}

export async function writeNativeOrTextClipboardForSelection(
  pane: PaneExplorerState | undefined,
): Promise<void> {
  const entries = H.selectedFileEntriesForPane(pane);
  if (entries.length === 0) return;

  const localItems = entries
    .filter((entry) => entry.location.kind === "local")
    .map((entry) => ({ path: entry.path, isDirectory: entry.kind === "folder" }));
  if (localItems.length === entries.length && (await clipboardWriteFileRefs(localItems))) {
    return;
  }

  const remoteEntries = entries.filter((entry) => entry.location.kind !== "local");
  if (remoteEntries.length > 0) {
    getExplorerStore()
      .getState()
      .pushNotification(
        `Preparing ${remoteEntries.length} remote ${remoteEntries.length === 1 ? "item" : "items"} for clipboard...`,
        "info",
        3500,
        false,
      );
  }

  const preparedRemoteResult =
    remoteEntries.length === 0
      ? null
      : await explorerPrepareDragItems({
          items: remoteEntries.map((entry) => ({
            path: entry.path,
            isDirectory: entry.kind === "folder",
            sizeBytes: entry.sizeBytes,
            remoteModified: entry.remoteModified,
          })),
        });
  if (preparedRemoteResult?.skipped.length) {
    getExplorerStore()
      .getState()
      .pushNotification(
        `Skipped ${preparedRemoteResult.skipped.length} remote ${preparedRemoteResult.skipped.length === 1 ? "item" : "items"} while preparing clipboard.`,
        "error",
        4500,
        false,
      );
  }
  const preparedRemoteItems =
    preparedRemoteResult?.items.map((item) => ({
      path: item.localPath,
      isDirectory: item.isDirectory,
    })) ?? [];
  const nativeItems = [...localItems, ...preparedRemoteItems];
  if (nativeItems.length > 0 && (await clipboardWriteFileRefs(nativeItems))) {
    if (preparedRemoteItems.length > 0) {
      getExplorerStore()
        .getState()
        .pushNotification(
          `Prepared ${preparedRemoteItems.length} remote ${preparedRemoteItems.length === 1 ? "item" : "items"} for clipboard.`,
          "success",
          3500,
          false,
        );
    }
    return;
  }

  await writeText(entries.map((entry) => H.clipboardTextForEntry(entry)).join("\n"));
}

export function explorerClipboardFromPayload(
  payload: ClipboardPayload,
): ExplorerClipboardState | null {
  if (payload.kind !== "file_refs" || payload.file_refs.length === 0) return null;
  const items = payload.file_refs
    .map(H.pasteItemFromClipboardRef)
    .filter((item): item is PasteItem => item !== null);
  return items.length > 0 ? { items, operation: "copy" } : null;
}

export function selectedFileEntriesForPane(pane: PaneExplorerState | undefined): FileEntry[] {
  if (!pane?.listing) return [];
  if (pane.listing.path === "misty://trash") return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter(
    (entry) => selected.has(entry.id) && H.isFileMasterEntry(entry),
  );
}

export function clipboardTextForEntry(entry: FileEntry): string {
  if (entry.location.kind === "local") return entry.path;
  const provider = entry.location.providerType ? `${entry.location.providerType}/` : "";
  const remoteName = entry.location.remoteName ?? "";
  const remotePath = entry.location.remotePath ?? entry.path;
  return `${provider}${remoteName}:${remotePath}`;
}

export function pasteItemFromClipboardRef(
  fileRef: ClipboardPayload["file_refs"][number],
): PasteItem | null {
  if (fileRef.local_path.trim()) {
    return { path: fileRef.local_path, isDirectory: fileRef.is_dir };
  }
  if (!fileRef.provider_type.trim() || !fileRef.remote_name.trim() || !fileRef.remote_path.trim()) {
    return null;
  }
  const environment = useAppStore.getState().app?.environment;
  if (!environment?.mountPath) return null;
  const settingsMountPath = selectAdvancedPreferences(
    useSettingsStore.getState().settings?.document,
  ).mountPath;
  const mountPath = H.resolveMountRoot(
    environment.homeDir,
    settingsMountPath || environment.mountPath,
  );
  return {
    path: H.remoteClipboardVirtualPath(
      mountPath,
      fileRef.provider_type,
      fileRef.remote_name,
      fileRef.remote_path,
    ),
    isDirectory: fileRef.is_dir,
  };
}

export function remoteClipboardVirtualPath(
  mountPath: string,
  _providerType: string,
  remoteName: string,
  remotePath: string,
): string {
  const base = [mountPath, remoteName]
    .map((part, index) => (index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "")))
    .filter(Boolean)
    .join("/");
  const child = remotePath.trim().replace(/^\/+/, "");
  return child ? `${base}/${child}` : base;
}

export function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) return configuredPath.replace(/\/+$/, "");
  return `${homePath.replace(/\/+$/, "")}/${configuredPath.replace(/^\/+|\/+$/g, "")}`;
}
