import type { ReactNode, RefObject } from "react";

/** Payload carried by an in-app pointer drag. `kind` lets zones filter what they accept. */
export interface PointerDragPayload {
  kind: string;
  id: string;
  data?: unknown;
}

export interface PointerDropZoneSpec {
  id: string;
  accepts: (payload: PointerDragPayload) => boolean;
  onDrop: (payload: PointerDragPayload) => void;
}

export interface PointerDragState {
  payload: PointerDragPayload | null;
  pointer: { x: number; y: number } | null;
  activeZoneId: string;
  preview: ReactNode;
}

export interface PointerDragContextValue {
  state: PointerDragState;
  /** Call from onPointerDown on the drag source. The drag arms and begins past a small threshold. */
  startDrag: (
    event: { clientX: number; clientY: number; button: number; isPrimary: boolean },
    payload: PointerDragPayload,
    preview?: ReactNode,
  ) => void;
  registerZone: (element: HTMLElement, spec: RefObject<PointerDropZoneSpec>) => () => void;
  cancel: () => void;
}
