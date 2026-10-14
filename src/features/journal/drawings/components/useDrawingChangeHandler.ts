import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useCallback, useRef } from "react";
import { localDrawingOrigin, writeDrawingElements } from "../collaboration/drawingSceneStore";
import type { DrawingRole } from "../types";
import type { CollaborativeDrawingCanvasProps } from "./collaborativeDrawingCanvasTypes";
import { drawingAiSnapshot } from "./drawingAiSnapshot";

/** Builds the Excalidraw onChange handler that mirrors local edits into the shared session. */
export function useDrawingChangeHandler(
  props: CollaborativeDrawingCanvasProps,
  api: ExcalidrawImperativeAPI | null,
  role: DrawingRole,
  shareBinaryFiles: (files: readonly BinaryFileData[]) => Promise<void>,
) {
  const onAiSnapshot = props.onAiSnapshot;
  const selectedElementsRef = useRef("");
  const aiSnapshotRef = useRef("");

  return useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (appState.openSidebar?.name === "default") {
        api?.updateScene({
          appState: { openSidebar: null },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
      const selected = JSON.stringify(appState.selectedElementIds);
      if (selected !== selectedElementsRef.current) {
        selectedElementsRef.current = selected;
        props.session.provider.awareness.setLocalStateField(
          "selectedElementIds",
          appState.selectedElementIds,
        );
      }
      const aiSnapshot = drawingAiSnapshot(elements, appState.selectedElementIds);
      if (onAiSnapshot && aiSnapshot.contentHash !== aiSnapshotRef.current) {
        aiSnapshotRef.current = aiSnapshot.contentHash;
        onAiSnapshot(aiSnapshot);
      }
      if (role === "viewer") return;
      void shareBinaryFiles(Object.values(files)).catch((cause) => {
        api?.setToast({
          message: cause instanceof Error ? cause.message : "A shared image could not be uploaded.",
          duration: 4000,
        });
      });
      writeDrawingElements(props.session.elements, elements);
      if (props.session.scene.get("viewBackgroundColor") !== appState.viewBackgroundColor) {
        props.session.doc.transact(() => {
          props.session.scene.set("viewBackgroundColor", appState.viewBackgroundColor);
        }, localDrawingOrigin);
      }
    },
    [api, onAiSnapshot, role, props.session, shareBinaryFiles],
  );
}
