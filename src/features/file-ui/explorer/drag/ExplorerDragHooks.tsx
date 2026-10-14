import {
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ExplorerDragItem, ExplorerDropZoneSpec } from "../model/drag";
import { ExplorerDragContext } from "./ExplorerDragState";
export function useExplorerDragSource(items: ExplorerDragItem[]) {
  const context = useContext(ExplorerDragContext);
  const dragging = Boolean(
    context?.state.payload?.origin === "internal" &&
    items.some((item) =>
      context.state.payload?.items.some((dragged) => dragged.entryId === item.entryId),
    ),
  );
  return useMemo(
    () => ({
      onPointerDown: context
        ? (event: ReactPointerEvent<HTMLElement>) => context.armSource(items, event)
        : undefined,
      dragging,
    }),
    [context, dragging, items],
  );
}

export function useExplorerDropZone(spec: ExplorerDropZoneSpec) {
  const context = useContext(ExplorerDragContext);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const registerZone = context?.registerZone;
  useLayoutEffect(
    () => (element && registerZone ? registerZone(element, spec) : undefined),
    [element, registerZone, spec],
  );
  const active = context?.state.activeZoneId === spec.id;
  return { ref: setElement, active, valid: active && context?.state.acceptance?.valid === true };
}
