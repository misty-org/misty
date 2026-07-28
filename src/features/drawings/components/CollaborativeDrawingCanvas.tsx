import type {
  AppState,
  Collaborator,
  ExcalidrawImperativeAPI,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import { CaptureUpdateAction, Excalidraw, reconcileElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppThemeStore } from "@/stores/app";
import {
  localDrawingOrigin,
  readDrawingElements,
  writeDrawingElements,
} from "../collaboration/drawingSceneStore";
import type { DrawingCollaborationSession } from "../collaboration/drawingCollaboration";
import type { SpaceDrawing } from "../types";

interface CollaborativeDrawingCanvasProps {
  drawing: SpaceDrawing;
  session: DrawingCollaborationSession;
}

export default function CollaborativeDrawingCanvas(props: CollaborativeDrawingCanvasProps) {
  const theme = useAppThemeStore((state) => state.resolvedTheme);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const selectedElementsRef = useRef("");
  const pointerPublisher = useMemo(() => createPointerPublisher(props.session), [props.session]);

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
    api.updateScene({
      collaborators: collaboratorsFromAwareness(props.session),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api, props.session]);

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

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
      const selected = JSON.stringify(appState.selectedElementIds);
      if (selected !== selectedElementsRef.current) {
        selectedElementsRef.current = selected;
        props.session.provider.awareness.setLocalStateField(
          "selectedElementIds",
          appState.selectedElementIds,
        );
      }
      if (props.drawing.role === "viewer") return;
      writeDrawingElements(props.session.elements, elements);
      if (props.session.scene.get("viewBackgroundColor") !== appState.viewBackgroundColor) {
        props.session.doc.transact(() => {
          props.session.scene.set("viewBackgroundColor", appState.viewBackgroundColor);
        }, localDrawingOrigin);
      }
    },
    [props.drawing.role, props.session],
  );

  return (
    <div className="h-full min-h-0 w-full" data-misty-window-drag-block="true">
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
        onPointerUpdate={pointerPublisher.publish}
        onPaste={(data) => {
          if (
            Object.keys(data.files ?? {}).length > 0 ||
            data.mixedContent?.some((item) => item.type === "imageUrl")
          ) {
            api?.setToast({
              message:
                "Shared image uploads are coming next. Shapes and text are fully collaborative.",
              duration: 4000,
            });
            return false;
          }
          return true;
        }}
        UIOptions={{
          tools: { image: false },
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
          },
        }}
      />
    </div>
  );
}

function collaboratorsFromAwareness(
  session: DrawingCollaborationSession,
): Map<SocketId, Collaborator> {
  const collaborators = new Map<SocketId, Collaborator>();
  for (const [clientId, state] of session.provider.awareness.getStates()) {
    if (clientId === session.doc.clientID) continue;
    const user = isRecord(state.user) ? state.user : {};
    const pointer = isRecord(state.pointer) ? state.pointer : undefined;
    collaborators.set(String(clientId) as SocketId, {
      id: typeof user.id === "string" ? user.id : String(clientId),
      username: typeof user.name === "string" ? user.name : "Collaborator",
      color: isCollaboratorColor(user.color) ? user.color : undefined,
      pointer:
        pointer &&
        typeof pointer.x === "number" &&
        typeof pointer.y === "number" &&
        (pointer.tool === "pointer" || pointer.tool === "laser")
          ? { x: pointer.x, y: pointer.y, tool: pointer.tool }
          : undefined,
      button: state.button === "down" ? "down" : "up",
      selectedElementIds: isSelectedElementIds(state.selectedElementIds)
        ? state.selectedElementIds
        : undefined,
    });
  }
  return collaborators;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCollaboratorColor(value: unknown): value is { background: string; stroke: string } {
  return (
    isRecord(value) && typeof value.background === "string" && typeof value.stroke === "string"
  );
}

function isSelectedElementIds(value: unknown): value is Readonly<Record<string, true>> {
  return isRecord(value) && Object.values(value).every((selected) => selected === true);
}
