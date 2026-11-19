import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  OrderedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type * as Y from "yjs";
import { readDrawingElements } from "./collaboration/drawingSceneStore";

/*
 * A whiteboard's frames are the parts Docs and Slides embed (plan W1). A frame's part id is its
 * Excalidraw element id, which never changes for the frame's life (moving, renaming or resizing
 * it keeps it), so an embed keeps pointing at the same frame.
 */

export interface DrawingFrame {
  /** The frame element's id: the embed's `part_id`. */
  id: string;
  /** The frame's own name, or "Frame n" in board order when it has none. */
  name: string;
}

const isFrame = (element: ExcalidrawElement): element is ExcalidrawFrameLikeElement =>
  (element.type === "frame" || element.type === "magicframe") && !element.isDeleted;

/** The frames of a scene, in the board's order. */
export function listDrawingFrames(elements: readonly ExcalidrawElement[]): DrawingFrame[] {
  let unnamed = 0;
  return elements.filter(isFrame).map((frame) => {
    const name = typeof frame.name === "string" ? frame.name.trim() : "";
    if (!name) unnamed += 1;
    return { id: frame.id, name: name || `Frame ${unnamed}` };
  });
}

/** The frames held in a drawing room's elements map. */
export function listRoomFrames(elements: Y.Map<OrderedExcalidrawElement>): DrawingFrame[] {
  return listDrawingFrames(readDrawingElements(elements));
}

/**
 * One frame and what sits in it, ready for export: the frame, every element whose `frameId` is
 * the frame, and the text bound to those. Null when the frame is gone.
 */
export function frameScene(
  elements: readonly ExcalidrawElement[],
  frameId: string,
): {
  frame: NonDeleted<ExcalidrawFrameLikeElement>;
  elements: NonDeleted<ExcalidrawElement>[];
} | null {
  const frame = elements.find(
    (element): element is NonDeleted<ExcalidrawFrameLikeElement> =>
      element.id === frameId && isFrame(element),
  );
  if (!frame) return null;
  const inside = new Set<string>([frame.id]);
  for (const element of elements) {
    if (!element.isDeleted && element.frameId === frame.id) inside.add(element.id);
  }
  for (const element of elements) {
    if (element.isDeleted || inside.has(element.id)) continue;
    const container = "containerId" in element ? element.containerId : null;
    if (container && inside.has(container)) inside.add(element.id);
  }
  return {
    frame,
    elements: elements.filter(
      (element): element is NonDeleted<ExcalidrawElement> =>
        !element.isDeleted && inside.has(element.id),
    ),
  };
}
