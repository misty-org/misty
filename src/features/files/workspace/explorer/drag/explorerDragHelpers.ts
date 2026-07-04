import type { PointerEvent as ReactPointerEvent } from "react";
import type { ExplorerDragItem, ExplorerDragModifiers } from "../model/interfaces/drag/types";
import { edgeScrollDelta } from "./geometry";
const EDGE_SCROLL_SIZE = 32;
export function modifiersFromEvent(
  event: Pick<PointerEvent | KeyboardEvent | ReactPointerEvent, "altKey" | "ctrlKey" | "shiftKey">,
): ExplorerDragModifiers {
  return { copyRequested: event.altKey || event.ctrlKey, moveRequested: event.shiftKey };
}

export function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest("button,input,textarea,select,a,[contenteditable=true],.inline-name-editor"),
    )
  );
}

export function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

export function autoScrollAt(x: number, y: number): void {
  if (typeof document.elementsFromPoint !== "function") return;
  const container = document
    .elementsFromPoint(x, y)
    .map((element) => element.closest<HTMLElement>("[data-explorer-scroll-container]"))
    .find(Boolean);
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const vertical = edgeScrollDelta(y, rect.top, rect.bottom, EDGE_SCROLL_SIZE);
  const horizontal = edgeScrollDelta(x, rect.left, rect.right, EDGE_SCROLL_SIZE);
  if (vertical || horizontal) container.scrollBy({ top: vertical, left: horizontal });
}

export function dragPreviewDataUrl(items: ExplorerDragItem[]): string {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (!context) return "data:image/png;base64,";
  context.fillStyle = "#131313";
  context.roundRect(4, 4, 120, 72, 14);
  context.fill();
  context.fillStyle = "#A3BFAB";
  context.fillRect(17, 22, 28, 24);
  context.fillStyle = "#F1F1F1";
  context.font = "600 13px sans-serif";
  context.fillText(
    items.length > 1 ? `${items.length} items` : (items[0]?.name ?? "Item"),
    54,
    39,
    62,
  );
  return canvas.toDataURL("image/png");
}
