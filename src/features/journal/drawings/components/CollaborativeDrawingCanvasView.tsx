import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import { readDrawingElements } from "../collaboration/drawingSceneStore";
import type { CollaborativeDrawingCanvasProps } from "./collaborativeDrawingCanvasTypes";
import { useDrawingAiController } from "./useDrawingAiController";
import { useDrawingChangeHandler } from "./useDrawingChangeHandler";
import { useDrawingFileSharing } from "./useDrawingFileSharing";
import { useDrawingImageHydration } from "./useDrawingImageHydration";
import { useDrawingSceneSync } from "./useDrawingSceneSync";
import { useDrawingSeed } from "./useDrawingSeed";
import "./collaborativeDrawingCanvas.css";

export type {
  CollaborativeDrawingCanvasProps,
  DrawingAiController,
  DrawingAiPatch,
  DrawingAiSnapshot,
} from "./collaborativeDrawingCanvasTypes";

export default function CollaborativeDrawingCanvasView(props: CollaborativeDrawingCanvasProps) {
  const { theme, openLink } = props.runtime;
  const role = props.session.role ?? props.drawing.role;
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const shareBinaryFiles = useDrawingFileSharing(props, role);
  const { followTracker, pointerPublisher } = useDrawingSceneSync(props, api, role);
  useDrawingImageHydration(props, api);
  useDrawingSeed(props, api, role);
  const handleChange = useDrawingChangeHandler(props, api, role, shareBinaryFiles);
  useDrawingAiController(props, api, role);

  return (
    <div className="misty-excalidraw h-full min-h-0 w-full" data-misty-window-drag-block="true">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={{
          elements: readDrawingElements(props.session.elements),
          appState: {
            viewBackgroundColor:
              (props.session.scene.get("viewBackgroundColor") as string | undefined) ?? "#ffffff",
          },
        }}
        name={props.drawing.title}
        theme={theme}
        isCollaborating
        viewModeEnabled={role === "viewer"}
        onChange={handleChange}
        onUserFollow={(payload) => {
          followTracker.record(payload, api?.getAppState().collaborators ?? new Map());
        }}
        onPointerUpdate={pointerPublisher.publish}
        onLinkOpen={
          openLink
            ? (element, event) => {
                event.preventDefault();
                if (element.link)
                  void openLink?.(element.link).catch((error) => {
                    api?.setToast({
                      message:
                        error instanceof Error ? error.message : "The link could not be opened.",
                      duration: 4000,
                    });
                  });
              }
            : undefined
        }
        onPaste={async (data) => {
          const files = Object.values(data.files ?? {});
          if (files.length > 0) {
            try {
              await shareBinaryFiles(files);
              return true;
            } catch (cause) {
              api?.setToast({
                message:
                  cause instanceof Error ? cause.message : "The image could not be uploaded.",
                duration: 4000,
              });
              return false;
            }
          }
          if (data.mixedContent?.some((item) => item.type === "imageUrl")) {
            api?.setToast({
              message: "Fetching and securing the shared image…",
              duration: 2000,
            });
          }
          return true;
        }}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  );
}
