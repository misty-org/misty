import type {
  ExplorerDragItem,
  ExplorerDragPayload,
  ExplorerDropZoneSpec,
} from "../../interfaces/drag/types";

export type ExplorerDragPhase =
  "idle" | "internal" | "external" | "preparing-egress" | "native-egress" | "dropping";

export type DropAction = "transfer" | "trash" | "library" | "invalid";

export type DragItem = ExplorerDragItem;

export type DragPayload = ExplorerDragPayload;

export type DropZoneSpec = ExplorerDropZoneSpec;
