import { useAppThemeStore } from "@/features/settings";
import { CaptureUpdateAction, Excalidraw, reconcileElements } from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawingCollaborationSession } from "../collaboration/drawingCollaboration";
import { collaboratorsFromAwareness, DrawingFollowTracker } from "../collaboration/drawingPresence";
import {
  localDrawingOrigin,
  readDrawingElements,
  writeDrawingElements,
} from "../collaboration/drawingSceneStore";
import { hydrateDrawingBinaryFile, uploadDrawingBinaryFile } from "../drawingAssets";
import type { SpaceDrawing } from "../types";
import "./collaborativeDrawingCanvas.css";

interface CollaborativeDrawingCanvasProps {
  drawing: SpaceDrawing;
  session: DrawingCollaborationSession;
}

export default function CollaborativeDrawingCanvas(props: CollaborativeDrawingCanvasProps) {
  const theme = useAppThemeStore((state) => state.resolvedTheme);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const selectedElementsRef = useRef("");
  const fileUploadsRef = useRef(new Map<string, Promise<void>>());
  const fileHydrationsRef = useRef(new Map<string, Promise<void>>());
  const pointerPublisher = useMemo(() => createPointerPublisher(props.session), [props.session]);
  const followTracker = useMemo(() => new DrawingFollowTracker(), []);

  const shareBinaryFiles = useCallback(
    async (files: readonly BinaryFileData[]) => {
      if (props.drawing.role === "viewer") return;
      await Promise.all(
        files.map(async (file) => {
          if (props.session.files.has(file.id)) return;
          const active = fileUploadsRef.current.get(file.id);
          if (active) return active;
          const upload = uploadDrawingBinaryFile(props.drawing.space_id, props.drawing.id, file)
            .then((reference) => {
              props.session.doc.transact(() => {
                props.session.files.set(file.id, reference);
              }, localDrawingOrigin);
            })
            .finally(() => {
              fileUploadsRef.current.delete(file.id);
            });
          fileUploadsRef.current.set(file.id, upload);
          return upload;
        }),
      );
    },
    [props.drawing.id, props.drawing.role, props.drawing.space_id, props.session],
  );

  const applySharedScene = useCallback(() => {
    if (!api) return;
    const remote = readDrawingElements(props.session.elements) as RemoteExcalidrawElement[];
    const reconciled = reconcileElements(
      api.getSceneElementsIncludingDeleted(),
      remote,
      api.getAppState(),
    );
    const viewBackgroundColor = props.session.scene.get("viewBackgroundColor");
    api.updateScene({
      elements: reconciled,
      appState: typeof viewBackgroundColor === "string" ? { viewBackgroundColor } : undefined,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    // If two users changed one element at the same version, reconciliation
    // chooses the lowest nonce. Reassert that winner into the CRDT map.
    writeDrawingElements(props.session.elements, reconciled);
  }, [api, props.session]);

  const applyCollaborators = useCallback(() => {
    if (!api) return;
    const collaborators = collaboratorsFromAwareness(
      props.session.provider.awareness,
      props.session.doc.clientID,
    );
    const followToRestore = followTracker.followToRestore(
      collaborators,
      api.getAppState().userToFollow,
    );
    api.updateScene({
      collaborators,
      appState: followToRestore ? { userToFollow: followToRestore } : undefined,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api, followTracker, props.session]);

  useEffect(() => {
    const onElementsChanged = (_events: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin !== localDrawingOrigin) applySharedScene();
    };
    const onSceneChanged = (_event: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin !== localDrawingOrigin) applySharedScene();
    };
    const onAwarenessChanged = () => applyCollaborators();
    props.session.elements.observeDeep(onElementsChanged);
    props.session.scene.observe(onSceneChanged);
    props.session.provider.awareness.on("change", onAwarenessChanged);
    applySharedScene();
    applyCollaborators();
    return () => {
      props.session.elements.unobserveDeep(onElementsChanged);
      props.session.scene.unobserve(onSceneChanged);
      props.session.provider.awareness.off("change", onAwarenessChanged);
      pointerPublisher.destroy();
    };
  }, [applyCollaborators, applySharedScene, pointerPublisher, props.session]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    const hydrateFiles = () => {
      for (const reference of props.session.files.values()) {
        if (api.getFiles()[reference.fileId] || fileHydrationsRef.current.has(reference.fileId)) {
          continue;
        }
        const hydration = hydrateDrawingBinaryFile(
          props.drawing.space_id,
          props.drawing.id,
          reference,
        )
          .then((file) => {
            if (active) api.addFiles([file]);
          })
          .catch((cause) => {
            if (!active) return;
            api.setToast({
              message:
                cause instanceof Error ? cause.message : "A shared image could not be loaded.",
              duration: 4000,
            });
          })
          .finally(() => {
            fileHydrationsRef.current.delete(reference.fileId);
          });
        fileHydrationsRef.current.set(reference.fileId, hydration);
      }
    };
    props.session.files.observe(hydrateFiles);
    hydrateFiles();
    return () => {
      active = false;
      props.session.files.unobserve(hydrateFiles);
    };
  }, [api, props.drawing.id, props.drawing.space_id, props.session.files]);

  const handleChange = useCallback(
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
      if (props.drawing.role === "viewer") return;
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
    [api, props.drawing.role, props.session, shareBinaryFiles],
  );

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
        viewModeEnabled={props.drawing.role === "viewer"}
        onChange={handleChange}
        onUserFollow={(payload) => {
          followTracker.record(payload, api?.getAppState().collaborators ?? new Map());
        }}
        onPointerUpdate={pointerPublisher.publish}
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

function createPointerPublisher(session: DrawingCollaborationSession) {
  let timer: number | null = null;
  let pending:
    | {
        pointer: { x: number; y: number; tool: "pointer" | "laser" };
        button: "down" | "up";
      }
    | undefined;
  const flush = () => {
    timer = null;
    if (!pending) return;
    session.provider.awareness.setLocalStateField("pointer", pending.pointer);
    session.provider.awareness.setLocalStateField("button", pending.button);
    pending = undefined;
  };
  return {
    publish(payload: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" };
      button: "down" | "up";
    }) {
      pending = payload;
      if (timer == null) timer = window.setTimeout(flush, 33);
    },
    destroy() {
      if (timer != null) window.clearTimeout(timer);
    },
  };
}
