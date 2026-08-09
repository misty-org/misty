import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  ExplorerDragItem,
  ExplorerDragViewState,
  ExplorerDropZoneSpec,
} from "../model/interfaces/drag/types";
export interface RegisteredZone {
  element: HTMLElement;
  spec: ExplorerDropZoneSpec;
}

export interface ArmedDrag {
  pointerId: number;
  source: HTMLElement;
  start: { x: number; y: number };
  items: ExplorerDragItem[];
}

export interface PreparedEgress {
  sessionId: string;
  promise: Promise<string[]>;
  settled: boolean;
  paths: string[] | null;
  error: string | null;
}

export interface ExplorerDragContextValue {
  state: ExplorerDragViewState;
  armSource: (items: ExplorerDragItem[], event: ReactPointerEvent<HTMLElement>) => void;
  registerZone: (element: HTMLElement, spec: ExplorerDropZoneSpec) => () => void;
  cancel: (message?: string) => void;
}
