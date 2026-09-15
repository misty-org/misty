import { CaptureUpdateAction, reconcileElements } from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo } from "react";
import { collaboratorsFromAwareness, DrawingFollowTracker } from "../collaboration/drawingPresence";
import {
  localDrawingOrigin,
  readDrawingElements,
  writeDrawingElements,
} from "../collaboration/drawingSceneStore";
import type { DrawingRole } from "../types";
import type { CollaborativeDrawingCanvasProps } from "./collaborativeDrawingCanvasTypes";
import { createPointerPublisher } from "./drawingPointerPublisher";

/** Keeps the Excalidraw scene, collaborator list and pointer broadcast in sync with the shared session. */
export function useDrawingSceneSync(
  props: CollaborativeDrawingCanvasProps,
  api: ExcalidrawImperativeAPI | null,
  role: DrawingRole,
) {
  const pointerPublisher = useMemo(() => createPointerPublisher(props.session), [props.session]);
  const followTracker = useMemo(() => new DrawingFollowTracker(), []);

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
    if (role !== "viewer") writeDrawingElements(props.session.elements, reconciled);
  }, [api, props.session, role]);

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

  return { followTracker, pointerPublisher };
}
