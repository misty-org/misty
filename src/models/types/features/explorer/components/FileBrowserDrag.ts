import type { FileEntry } from "@/models/interfaces/services/misty-api";
import { invalidTransferReason, storageIdForPath } from "@/features/explorer/drag/operations";
import type {
  DropAcceptance,
  ExplorerDragItem,
  ExplorerDragPayload,
} from "@/models/interfaces/features/explorer/drag/types";

export type FileBrowserDragItem = ExplorerDragItem;
