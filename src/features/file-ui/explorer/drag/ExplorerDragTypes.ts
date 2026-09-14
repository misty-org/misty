import type { PointerEvent as ReactPointerEvent } from "react";
import type { ExplorerDragItem, ExplorerDragViewState, ExplorerDropZoneSpec } from "../model/drag";
export interface ExplorerDragContextValue {
  state: ExplorerDragViewState;
  armSource: (items: ExplorerDragItem[], event: ReactPointerEvent<HTMLElement>) => void;
  registerZone: (element: HTMLElement, spec: ExplorerDropZoneSpec) => () => void;
  cancel: (message?: string) => void;
}
