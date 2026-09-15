import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect } from "react";
import { localDrawingOrigin, writeDrawingElements } from "../collaboration/drawingSceneStore";
import type { DrawingRole } from "../types";
import type {
  CollaborativeDrawingCanvasProps,
  DrawingAiController,
  DrawingAiPatch,
} from "./collaborativeDrawingCanvasTypes";
import { drawingAiSnapshot } from "./drawingAiSnapshot";

/** Exposes a controller that lets Misty move selected elements, guarded by the snapshot hash. */
export function useDrawingAiController(
  props: CollaborativeDrawingCanvasProps,
  api: ExcalidrawImperativeAPI | null,
  role: DrawingRole,
) {
  const onAiController = props.onAiController;
  useEffect(() => {
    if (!api || !onAiController) return;
    const resolvePatch = (patch: DrawingAiPatch) => {
      const elements = api.getSceneElementsIncludingDeleted();
      const selectedIds = api.getAppState().selectedElementIds;
      const snapshot = drawingAiSnapshot(elements, selectedIds);
      if (
        role === "viewer" ||
        snapshot.selectedCount === 0 ||
        patch.base_hash !== snapshot.contentHash ||
        !patch.changes?.length ||
        patch.changes.length > 100
      )
        return null;
      const byId = new Map(elements.map((element) => [element.id, element]));
      const seen = new Set<string>();
      const updates = new Map<string, { x: number; y: number }>();
      for (const change of patch.changes) {
        const id = change.element_id ?? "";
        const current = byId.get(id);
        const x = change.element?.x;
        const y = change.element?.y;
        if (
          change.op !== "update" ||
          !current ||
          current.isDeleted ||
          !selectedIds[id] ||
          seen.has(id) ||
          typeof x !== "number" ||
          typeof y !== "number" ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          Math.abs(x) > 100_000 ||
          Math.abs(y) > 100_000
        )
          return null;
        seen.add(id);
        updates.set(id, { x, y });
      }
      return { elements, updates };
    };
    const controller: DrawingAiController = {
      canApply: (patch) => Boolean(resolvePatch(patch)),
      apply: (patch) => {
        const resolved = resolvePatch(patch);
        if (!resolved)
          throw new Error("The drawing selection changed. Ask Misty to regenerate this layout.");
        const next = resolved.elements.map((element) => {
          const update = resolved.updates.get(element.id);
          return update
            ? {
                ...element,
                ...update,
                version: element.version + 1,
                versionNonce: Math.floor(Math.random() * 2_147_483_647),
                updated: Date.now(),
              }
            : element;
        }) as OrderedExcalidrawElement[];
        props.session.doc.transact(() => {
          writeDrawingElements(props.session.elements, next);
        }, localDrawingOrigin);
        api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      },
    };
    onAiController(controller);
    return () => onAiController(null);
  }, [api, onAiController, role, props.session]);
}
