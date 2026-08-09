import type { ExplorerLocation } from "@/services/misty/model/misty-api";

import type { DropAction, ExplorerDragPhase } from "../../types/drag/types";

export interface ExplorerDragItem {
  entryId?: string;
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes?: number | null;
  remoteModified?: string | null;
  location?: ExplorerLocation | null;
  storageId?: string;
}

export interface ExplorerDragPayload {
  sessionId: string;
  origin: "internal" | "external";
  items: ExplorerDragItem[];
}

export interface ExplorerDragModifiers {
  copyRequested: boolean;
  moveRequested: boolean;
}

export interface DropAcceptance {
  valid: boolean;
  label: string;
  reason?: string;
  action?: DropAction;
}

export interface ExplorerDropZoneSpec {
  id: string;
  priority?: number;
  accepts: (payload: ExplorerDragPayload, modifiers: ExplorerDragModifiers) => DropAcceptance;
  onDrop: (payload: ExplorerDragPayload, modifiers: ExplorerDragModifiers) => void | Promise<void>;
  onSpringLoad?: () => void;
  springLoad?: boolean;
}

export interface ExplorerDragViewState {
  phase: ExplorerDragPhase;
  payload: ExplorerDragPayload | null;
  pointer: { x: number; y: number } | null;
  activeZoneId: string | null;
  acceptance: DropAcceptance | null;
  preparing: boolean;
  error: string | null;
}
