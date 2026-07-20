import { useMemo, type ReactNode } from "react";
import {
  explorerPathIsDirectory,
  explorerPrepareDragItems,
  explorerQueueDeleteItems,
} from "@/stores/backend";
import { useMultiPanelStore } from "@/features/workspace";
import { useExplorerStore } from "@/stores/explorer";
import { useSmartLibraryStore } from "@/stores/media/useSmartLibraryStore";
import { transferDropAcceptance } from "@/features/explorer/components/FileBrowserDrag";
import { Droppable } from "@/features/explorer/drag/ExplorerDragContext";
import { groupItemsByOperation, storageIdForPath } from "@/features/explorer/drag/operations";
import type {
  ExplorerDragModifiers,
  ExplorerDragPayload,
  ExplorerDropZoneSpec,
} from "@/models/interfaces/features/explorer/drag/types";

export type TargetKind = "directory" | "trash" | "library" | "invalid";
