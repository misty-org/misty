import { useEffect, useRef } from "react";
import {
  clampNavigatorWidth,
  navigatorMinWidth,
  navigatorMaxWidth,
  navigatorWidths,
} from "./navigatorMode";

export function NavigatorResizeHandle(props: {
  side?: "left" | "right";
  width: number;
  zoom: number;
  onChange: (width: number) => void;
  onResizingChange: (resizing: boolean) => void;
}) {
  const direction = props.side === "right" ? -1 : 1;
  const latest = useRef(props);
  latest.current = props;
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);

  return (
    <div
      role="separator"
      aria-label="Sidebar width"
      aria-orientation="vertical"
      aria-valuemin={navigatorMinWidth}
      aria-valuemax={navigatorMaxWidth}
      aria-valuenow={props.width}
      tabIndex={0}
      aria-description="Drag to resize. Double-click to reset."
      onDoubleClick={() => props.onChange(navigatorWidths.full)}
      data-misty-window-drag-block="true"
      className={`group absolute inset-y-0 ${props.side === "right" ? "left-0" : "right-0"} z-30 w-1.5 touch-none cursor-col-resize focus-visible:outline-none`}
      onKeyDown={(event) => {
        const width =
          event.key === "ArrowLeft"
            ? props.width - 10 * direction
            : event.key === "ArrowRight"
              ? props.width + 10 * direction
              : event.key === "Home"
                ? navigatorMinWidth
                : event.key === "End"
                  ? navigatorMaxWidth
                  : null;
        if (width === null) return;
        event.preventDefault();
        event.stopPropagation();
        props.onChange(clampNavigatorWidth(width));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault();
        event.stopPropagation();
        cleanup.current?.();
        const startX = event.clientX;
        const startWidth = props.width;
        const pointerId = event.pointerId;
        const handle = event.currentTarget;
        const previousCursor = document.documentElement.style.cursor;
        const previousSelection = document.documentElement.style.userSelect;
        document.documentElement.style.cursor = "col-resize";
        document.documentElement.style.userSelect = "none";
        latest.current.onResizingChange(true);
        const move = (next: PointerEvent) => {
          if (next.pointerId !== pointerId) return;
          next.preventDefault();
          latest.current.onChange(
            clampNavigatorWidth(startWidth + ((next.clientX - startX) * direction) / props.zoom),
          );
        };
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          window.removeEventListener("blur", stop);
          window.removeEventListener("keydown", key);
          handle.removeEventListener("lostpointercapture", stop);
          document.documentElement.style.cursor = previousCursor;
          document.documentElement.style.userSelect = previousSelection;
          cleanup.current = undefined;
          latest.current.onResizingChange(false);
          if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        };
        const finish = (next: PointerEvent) => {
          if (next.pointerId === pointerId) stop();
        };
        const key = (next: KeyboardEvent) => {
          if (next.key !== "Escape") return;
          next.preventDefault();
          latest.current.onChange(startWidth);
          stop();
        };
        cleanup.current = stop;
        window.addEventListener("pointermove", move, { passive: false });
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        window.addEventListener("blur", stop);
        window.addEventListener("keydown", key);
        handle.addEventListener("lostpointercapture", stop);
        handle.setPointerCapture?.(pointerId);
      }}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 ${props.side === "right" ? "left-0" : "right-0"} w-px bg-transparent transition-none group-hover:bg-cream-bright group-focus-visible:bg-cream-bright group-active:bg-cream-bright`}
      />
    </div>
  );
}
