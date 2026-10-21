import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect } from "react";
import { writeDrawingElements } from "../collaboration/drawingSceneStore";
import type { DrawingRole } from "../types";
import type { CollaborativeDrawingCanvasProps } from "./collaborativeDrawingCanvasTypes";

/** Elements waiting for a drawing that was just made from a reply's sketch, by drawing id. */
const seeds = new Map<string, OrderedExcalidrawElement[]>();

/** Hands a new drawing the elements it starts with; its canvas places them when it opens. */
export function seedDrawing(drawingId: string, elements: OrderedExcalidrawElement[]) {
  seeds.set(drawingId, elements);
}

/** Places a new drawing's starting elements once, the way a Figma reference is placed. */
export function useDrawingSeed(
  props: CollaborativeDrawingCanvasProps,
  api: ExcalidrawImperativeAPI | null,
  role: DrawingRole,
) {
  useEffect(() => {
    const elements = seeds.get(props.drawing.id);
    if (!api || !elements || role === "viewer") return;
    seeds.delete(props.drawing.id);
    const next = [...api.getSceneElementsIncludingDeleted(), ...elements];
    writeDrawingElements(props.session.elements, next);
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
    api.scrollToContent(elements, { fitToContent: true });
  }, [api, role, props.drawing.id, props.session.elements]);
}
