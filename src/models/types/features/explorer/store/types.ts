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
import { clipboardImagePng } from "@/features/explorer/utils/clipboardImage";
import { publishCloudFolderBotNotification } from "@/features/bots/cloudFolderBot";
import type { StateCreator } from "zustand";

import type {
  ExplorerWorkspaceEntry,
  ExplorerNotification,
  ExplorerSortState,
  PaneExplorerState,
  LoadPaneOptions,
  ExplorerContextMenuState,
  ExplorerClipboardState,
  ExplorerInlineEditState,
  ExplorerBatchRenameItem,
  ExplorerStore,
} from "@/models/interfaces/features/explorer/store/types";

export type ExplorerViewMode = "list" | "grid";

export type ExplorerCommandQueryMode = "search" | "filter";

export type ExplorerSortColumn = "name" | "modified" | "size" | "type";

export type ExplorerSortDirection = "asc" | "desc";

export type ExplorerUploadSourceKind = "files" | "folders";

export type ExplorerDeleteMode = "trash" | "permanent";

export type ExplorerNotificationType = "info" | "success" | "error";

export type NavigationMode = "push" | "back" | "forward" | "replace";

export type ExplorerDialogState =
  | { kind: "delete"; paneId: string; paths: string[]; permanent: boolean }
  | { kind: "batchRename"; paneId: string; items: ExplorerBatchRenameItem[] }
  | null;

export type ExplorerSet = Parameters<StateCreator<ExplorerStore>>[0];

export type ExplorerGet = Parameters<StateCreator<ExplorerStore>>[1];
