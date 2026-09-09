import type { StateCreator } from "zustand";

import type { ExplorerBatchRenameItem, ExplorerStore } from "../../interfaces/store/types";

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
