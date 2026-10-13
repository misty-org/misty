import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect } from "react";
import { writeDrawingElements } from "../collaboration/drawingSceneStore";
import { buildFigmaReferenceElements, hasFigmaReference } from "../figma/figmaCanvasElements";
import type { DrawingRole } from "../types";
import type { CollaborativeDrawingCanvasProps } from "./collaborativeDrawingCanvasTypes";

/** Places a requested Figma reference beside the existing drawing, once per Figma version. */
export function useFigmaReferenceImport(
  props: CollaborativeDrawingCanvasProps,
  api: ExcalidrawImperativeAPI | null,
  role: DrawingRole,
) {
  useEffect(() => {
    if (!api || !props.figmaImport || role === "viewer") return;
    const current = api.getSceneElementsIncludingDeleted();
    if (hasFigmaReference(current, props.figmaImport.reference)) {
      api.setToast({ message: "This Figma version is already on the canvas.", duration: 3000 });
      return;
    }
    const visible = current.filter((element) => !element.isDeleted);
    const rightEdge = visible.reduce(
      (maximum, element) => Math.max(maximum, element.x + element.width),
      -80,
    );
    const x = Math.max(-100_000, Math.min(100_000, rightEdge + 80));
    const y = Math.max(
      -100_000,
      Math.min(100_000, visible.length ? Math.min(...visible.map((element) => element.y)) : 0),
    );
    const referenceElements = buildFigmaReferenceElements(props.figmaImport.reference, x, y);
    const next = [...current, ...referenceElements];
    writeDrawingElements(props.session.elements, next);
    api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.NEVER });
    api.setToast({ message: "Figma reference added to this drawing.", duration: 3000 });
  }, [api, role, props.figmaImport, props.session.elements]);
}
