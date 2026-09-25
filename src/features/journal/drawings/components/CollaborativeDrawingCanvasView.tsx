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
import type { DrawingSession } from "../drawingRuntime";
import type { DrawingAssetReference } from "../types";
import { collaboratorsFromAwareness, DrawingFollowTracker } from "../collaboration/drawingPresence";
import {
  localDrawingOrigin,
  readDrawingElements,
  writeDrawingElements,
} from "../collaboration/drawingSceneStore";
import type { SpaceDrawing } from "../types";
import { buildFigmaReferenceElements, hasFigmaReference } from "../figma/figmaCanvasElements";
import type { FigmaCanvasReference } from "../figma/figmaCanvasReference";
import "./collaborativeDrawingCanvas.css";

export interface DrawingCanvasRuntime {
  theme: "light" | "dark";
  openLink?(url: string): Promise<void>;
  upload(space: string, drawing: string, file: BinaryFileData): Promise<DrawingAssetReference>;
  hydrate(
    space: string,
    drawing: string,
    reference: DrawingAssetReference,
  ): Promise<BinaryFileData>;
}
export interface CollaborativeDrawingCanvasProps {
  runtime: DrawingCanvasRuntime;
  drawing: SpaceDrawing;
  session: DrawingSession;
  figmaImport?: { requestId: number; reference: FigmaCanvasReference };
  onAiSnapshot?: (snapshot: DrawingAiSnapshot) => void;
  onAiController?: (controller: DrawingAiController | null) => void;
}

export interface DrawingAiSnapshot {
  content: string;
  contentHash: string;
  selectedCount: number;
  elementCount: number;
}

export interface DrawingAiPatch {
  base_hash?: string;
  changes?: Array<{
    op?: string;
    element_id?: string;
    element?: { x?: number; y?: number };
  }>;
}

export interface DrawingAiController {
  canApply: (patch: DrawingAiPatch) => boolean;
  apply: (patch: DrawingAiPatch) => void;
}

export default function CollaborativeDrawingCanvasView(props: CollaborativeDrawingCanvasProps) {
  const { theme, upload: uploadImage, hydrate: hydrateImage, openLink } = props.runtime;
  const role = props.session.role ?? props.drawing.role;
  const currentSession = useRef({ session: props.session, role });
  currentSession.current = { session: props.session, role };
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const selectedElementsRef = useRef("");
  const aiSnapshotRef = useRef("");
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const fileUploadsRef = useRef(new Map<string, Promise<void>>());
  const fileHydrationsRef = useRef(new Map<string, Promise<void>>());
  const onAiSnapshot = props.onAiSnapshot;
  const onAiController = props.onAiController;
  const pointerPublisher = useMemo(() => createPointerPublisher(props.session), [props.session]);
  const followTracker = useMemo(() => new DrawingFollowTracker(), []);

  const shareBinaryFiles = useCallback(
    async (files: readonly BinaryFileData[]) => {
      if (role === "viewer") return;
      await Promise.all(
        files.map(async (file) => {
          if (props.session.files.has(file.id)) return;
          const active = fileUploadsRef.current.get(file.id);
          if (active) return active;
          const upload = uploadImage(props.drawing.space_id, props.drawing.id, file)
            .then((reference) => {
              if (
                !activeRef.current ||
                props.session.doc.isDestroyed ||
                currentSession.current.session.key !== props.session.key ||
                currentSession.current.role === "viewer"
              )
                return;
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
    [props.drawing.id, role, props.drawing.space_id, props.session, uploadImage],
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

  useEffect(() => {
    if (!api) return;
    let active = true;
    const hydrateFiles = () => {
      for (const reference of props.session.files.values()) {
        if (api.getFiles()[reference.fileId] || fileHydrationsRef.current.has(reference.fileId)) {
          continue;
        }
        const hydration = hydrateImage(props.drawing.space_id, props.drawing.id, reference)
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
  }, [api, props.drawing.id, props.drawing.space_id, props.session.files, hydrateImage]);

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

function drawingAiSnapshot(
  elements: readonly OrderedExcalidrawElement[],
  selectedElementIds: Readonly<Record<string, boolean>>,
): DrawingAiSnapshot {
  const visible = elements.filter((element) => !element.isDeleted);
  const selected = visible.filter((element) => selectedElementIds[element.id]);
  const relevant = (selected.length ? selected : visible).slice(0, 160);
  const content = JSON.stringify({
    scope: selected.length ? "selection" : "visible_scene",
    truncated: relevant.length < (selected.length ? selected.length : visible.length),
    elements: relevant.map((element) => ({
      id: element.id,
      type: element.type,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
      angle: Math.round(element.angle * 1000) / 1000,
      text:
        "text" in element && typeof element.text === "string"
          ? element.text.slice(0, 1000)
          : undefined,
      link: typeof element.link === "string" ? element.link.slice(0, 1000) : undefined,
      group_ids: element.groupIds.slice(0, 20),
      bound_to:
        "boundElements" in element && Array.isArray(element.boundElements)
          ? element.boundElements.slice(0, 20).map((bound) => bound.id)
          : undefined,
    })),
  }).slice(0, 32 << 10);
  return {
    content,
    contentHash: drawingAiHash(content),
    selectedCount: selected.length,
    elementCount: visible.length,
  };
}

function drawingAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}

function createPointerPublisher(session: DrawingSession) {
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
