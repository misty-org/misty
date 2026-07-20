import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  explorerCancelDragPreparation,
  explorerPrepareDragItems,
} from "@/services/misty-api/misty";
import { getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
import { hasTauriInternals } from "@/shared/tauri";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import {
  dragDistance,
  edgeScrollDelta,
  physicalToClientPoint,
  selectDropCandidate,
} from "./geometry";
import { DragInteractionShield } from "../../../components/ui/drag-layer";
import { dragAnnouncement, ExplorerDragPreview, setWebviewDragActive } from "./ExplorerDragPreview";
import type {
  ExplorerDragItem,
  ExplorerDragModifiers,
  ExplorerDragPayload,
  ExplorerDragViewState,
  ExplorerDropZoneSpec,
} from "./types";

const DRAG_THRESHOLD = 6;
const SPRING_LOAD_MS = 700;
const EDGE_SCROLL_SIZE = 32;

interface RegisteredZone {
  element: HTMLElement;
  spec: ExplorerDropZoneSpec;
}

interface ArmedDrag {
  pointerId: number;
  source: HTMLElement;
  start: { x: number; y: number };
  items: ExplorerDragItem[];
}

interface PreparedEgress {
  sessionId: string;
  promise: Promise<string[]>;
  settled: boolean;
  paths: string[] | null;
  error: string | null;
}

interface ExplorerDragContextValue {
  state: ExplorerDragViewState;
  armSource: (items: ExplorerDragItem[], event: ReactPointerEvent<HTMLElement>) => void;
  registerZone: (element: HTMLElement, spec: ExplorerDropZoneSpec) => () => void;
  cancel: (message?: string) => void;
}

const initialState: ExplorerDragViewState = {
  phase: "idle",
  payload: null,
  pointer: null,
  activeZoneId: null,
  acceptance: null,
  preparing: false,
  error: null,
};

const ExplorerDragContext = createContext<ExplorerDragContextValue | null>(null);

export function ExplorerDragProvider(props: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  const armedRef = useRef<ArmedDrag | null>(null);
  const pointerHeldRef = useRef(false);
  const zonesRef = useRef(new Map<string, RegisteredZone>());
  const modifiersRef = useRef<ExplorerDragModifiers>({
    copyRequested: false,
    moveRequested: false,
  });
  const preparedRef = useRef<PreparedEgress | null>(null);
  const nativeEgressRef = useRef(false);
  const scaleFactorRef = useRef(1);
  const springTimerRef = useRef<number | null>(null);
  const hitFrameRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const cancel = useCallback((message?: string) => {
    const prepared = preparedRef.current;
    if (prepared && !prepared.settled)
      void explorerCancelDragPreparation(prepared.sessionId).catch(() => undefined);
    preparedRef.current = null;
    armedRef.current = null;
    pointerHeldRef.current = false;
    if (springTimerRef.current !== null) window.clearTimeout(springTimerRef.current);
    springTimerRef.current = null;
    if (hitFrameRef.current !== null) window.cancelAnimationFrame(hitFrameRef.current);
    hitFrameRef.current = null;
    zonesRef.current.forEach(({ element }) => delete element.dataset.explorerDropActive);
    setWebviewDragActive(false);
    const next = message ? { ...initialState, error: message } : initialState;
    stateRef.current = next;
    setState(next);
  }, []);

  const resolveTargetAt = useCallback((x: number, y: number) => {
    const payload = stateRef.current.payload;
    if (!payload || typeof document.elementsFromPoint !== "function") return;
    const candidates: Array<{ zone: RegisteredZone; depth: number }> = [];
    const seen = new Set<string>();
    document.elementsFromPoint(x, y).forEach((element, depth) => {
      const zoneElement = element.closest<HTMLElement>("[data-explorer-drop-zone-id]");
      const id = zoneElement?.dataset.explorerDropZoneId;
      if (!id || seen.has(id)) return;
      const zone = zonesRef.current.get(id);
      if (!zone) return;
      seen.add(id);
      candidates.push({ zone, depth });
    });
    const selected =
      selectDropCandidate(
        candidates.map((candidate) => ({
          ...candidate,
          priority: candidate.zone.spec.priority ?? 0,
        })),
      )?.zone ?? null;
    const acceptance = selected?.spec.accepts(payload, modifiersRef.current) ?? null;
    zonesRef.current.forEach(({ element }) => delete element.dataset.explorerDropActive);
    if (selected) selected.element.dataset.explorerDropActive = "true";
    const next = {
      ...stateRef.current,
      pointer: { x, y },
      activeZoneId: selected?.spec.id ?? null,
      acceptance,
    };
    stateRef.current = next;
    setState(next);
    autoScrollAt(x, y);
  }, []);

  const scheduleHitTest = useCallback(
    (x: number, y: number) => {
      if (hitFrameRef.current !== null) window.cancelAnimationFrame(hitFrameRef.current);
      hitFrameRef.current = window.requestAnimationFrame(() => {
        hitFrameRef.current = null;
        resolveTargetAt(x, y);
      });
    },
    [resolveTargetAt],
  );

  const registerZone = useCallback(
    (element: HTMLElement, spec: ExplorerDropZoneSpec) => {
      element.dataset.explorerDropZoneId = spec.id;
      zonesRef.current.set(spec.id, { element, spec });
      const pointer = stateRef.current.pointer;
      if (stateRef.current.payload && pointer) scheduleHitTest(pointer.x, pointer.y);
      return () => {
        if (zonesRef.current.get(spec.id)?.element === element) zonesRef.current.delete(spec.id);
        if (element.dataset.explorerDropZoneId === spec.id)
          delete element.dataset.explorerDropZoneId;
        delete element.dataset.explorerDropActive;
      };
    },
    [scheduleHitTest],
  );

  const beginPreparation = useCallback((payload: ExplorerDragPayload) => {
    const remoteItems = payload.items.filter(
      (item) => item.location && item.location.kind !== "local",
    );
    const localPaths = payload.items
      .filter((item) => !item.location || item.location.kind === "local")
      .map((item) => item.path);
    const sessionId = payload.sessionId;
    const preparation: PreparedEgress = {
      sessionId,
      settled: remoteItems.length === 0,
      paths: remoteItems.length === 0 ? localPaths : null,
      error: null,
      promise: Promise.resolve(localPaths),
    };
    if (remoteItems.length > 0) {
      preparation.promise = explorerPrepareDragItems({
        sessionId,
        items: remoteItems.map((item) => ({
          path: item.path,
          isDirectory: item.isDirectory,
          sizeBytes: item.sizeBytes,
          remoteModified: item.remoteModified,
        })),
      })
        .then((result) => {
          if (result.skipped.length > 0) {
            useExplorerStore
              .getState()
              .pushNotification(
                `Skipped ${result.skipped.length} item(s) while preparing drag-out.`,
                "error",
              );
          }
          const paths = [...localPaths, ...result.items.map((item) => item.localPath)];
          if (paths.length === 0) throw new Error("No items could be prepared for drag-out.");
          preparation.paths = paths;
          preparation.settled = true;
          return paths;
        })
        .catch((error: unknown) => {
          preparation.settled = true;
          preparation.error = error instanceof Error ? error.message : String(error);
          throw error;
        });
      void preparation.promise.catch(() => undefined);
    }
    preparedRef.current = preparation;
  }, []);

  const beginInternal = useCallback(
    (armed: ArmedDrag, point: { x: number; y: number }) => {
      const payload: ExplorerDragPayload = {
        sessionId: crypto.randomUUID(),
        origin: "internal",
        items: armed.items,
      };
      stateRef.current = { ...initialState, phase: "internal", payload, pointer: point };
      setState(stateRef.current);
      setWebviewDragActive(true);
      beginPreparation(payload);
      scheduleHitTest(point.x, point.y);
    },
    [beginPreparation, scheduleHitTest],
  );

  const performDrop = useCallback(async () => {
    const current = stateRef.current;
    if (!current.payload || !current.activeZoneId || !current.acceptance?.valid) {
      cancel();
      return;
    }
    const zone = zonesRef.current.get(current.activeZoneId);
    if (!zone) {
      cancel();
      return;
    }
    stateRef.current = { ...current, phase: "dropping" };
    setState(stateRef.current);
    try {
      await zone.spec.onDrop(current.payload, modifiersRef.current);
      cancel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useExplorerStore.getState().pushNotification(`Drop failed: ${message}`, "error");
      cancel(message);
    }
  }, [cancel]);

  const beginNativeEgress = useCallback(async () => {
    const current = stateRef.current;
    const preparation = preparedRef.current;
    if (current.phase !== "internal" || !current.payload || !preparation) return;
    stateRef.current = { ...current, phase: "preparing-egress", preparing: !preparation.settled };
    setState(stateRef.current);
    try {
      const paths = preparation.paths ?? (await preparation.promise);
      if (!pointerHeldRef.current || paths.length === 0) return cancel();
      const allLocal = current.payload.items.every(
        (item) => !item.location || item.location.kind === "local",
      );
      const mode = modifiersRef.current.moveRequested && allLocal ? "move" : "copy";
      stateRef.current = { ...stateRef.current, phase: "native-egress", preparing: false };
      setState(stateRef.current);
      nativeEgressRef.current = true;
      const { startDrag } = await import("@crabnebula/tauri-plugin-drag");
      await startDrag(
        { item: paths, icon: dragPreviewDataUrl(current.payload.items), mode },
        (event) => {
          if (event.result === "Dropped" && mode === "move") refreshExplorerPanes();
          cancel();
          window.setTimeout(() => {
            nativeEgressRef.current = false;
          }, 250);
        },
      );
    } catch (error) {
      nativeEgressRef.current = false;
      const message = error instanceof Error ? error.message : String(error);
      useExplorerStore.getState().pushNotification(`Could not start drag-out: ${message}`, "error");
      cancel(message);
    }
  }, [cancel]);

  const armSource = useCallback(
    (items: ExplorerDragItem[], event: ReactPointerEvent<HTMLElement>) => {
      if (
        event.button !== 0 ||
        event.isPrimary === false ||
        items.length === 0 ||
        isInteractiveDragTarget(event.target)
      )
        return;
      pointerHeldRef.current = true;
      modifiersRef.current = modifiersFromEvent(event);
      armedRef.current = {
        pointerId: event.pointerId,
        source: event.currentTarget,
        start: { x: event.clientX, y: event.clientY },
        items,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      modifiersRef.current = modifiersFromEvent(event);
      const point = { x: event.clientX, y: event.clientY };
      const armed = armedRef.current;
      if (
        armed &&
        stateRef.current.phase === "idle" &&
        dragDistance(armed.start, point) >= DRAG_THRESHOLD
      ) {
        beginInternal(armed, point);
      }
      if (stateRef.current.phase === "internal") scheduleHitTest(point.x, point.y);
    };
    const onPointerUp = () => {
      pointerHeldRef.current = false;
      armedRef.current = null;
      if (stateRef.current.phase === "internal") void performDrop();
      else if (stateRef.current.phase === "preparing-egress") cancel();
    };
    const onPointerOut = (event: PointerEvent) => {
      if (
        event.relatedTarget == null &&
        pointerHeldRef.current &&
        stateRef.current.phase === "internal"
      )
        void beginNativeEgress();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      modifiersRef.current = modifiersFromEvent(event);
      if (event.key === "Escape" && stateRef.current.phase !== "idle") cancel("Drag canceled.");
    };
    const onKeyUp = (event: KeyboardEvent) => {
      modifiersRef.current = modifiersFromEvent(event);
    };
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    const onPointerCancel = () => cancel();
    const onLostPointerCapture = () => {
      const armed = armedRef.current;
      if (
        pointerHeldRef.current &&
        stateRef.current.phase === "internal" &&
        armed &&
        !armed.source.isConnected
      ) {
        return;
      }
      cancel();
    };
    const onBlur = () => cancel();
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("lostpointercapture", onLostPointerCapture, true);
    window.addEventListener("pointerout", onPointerOut, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("lostpointercapture", onLostPointerCapture, true);
      window.removeEventListener("pointerout", onPointerOut, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [beginInternal, beginNativeEgress, cancel, performDrop, scheduleHitTest]);

  useEffect(() => {
    const zone = state.activeZoneId ? zonesRef.current.get(state.activeZoneId) : null;
    if (springTimerRef.current !== null) window.clearTimeout(springTimerRef.current);
    springTimerRef.current = null;
    if (!zone?.spec.springLoad || !zone.spec.onSpringLoad) return;
    springTimerRef.current = window.setTimeout(() => {
      springTimerRef.current = null;
      zone.spec.onSpringLoad?.();
      const pointer = stateRef.current.pointer;
      if (pointer) window.requestAnimationFrame(() => resolveTargetAt(pointer.x, pointer.y));
    }, SPRING_LOAD_MS);
    return () => {
      if (springTimerRef.current !== null) window.clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
    };
  }, [resolveTargetAt, state.activeZoneId]);

  useEffect(() => {
    const preventNativeWebviewDrag = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragstart", preventNativeWebviewDrag, true);
    return () => window.removeEventListener("dragstart", preventNativeWebviewDrag, true);
  }, []);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([import("@tauri-apps/api/webview"), import("@tauri-apps/api/window")])
      .then(async ([webviewApi, windowApi]) => {
        if (disposed) return;
        const appWindow = windowApi.getCurrentWindow();
        scaleFactorRef.current = await appWindow.scaleFactor();
        unlisteners.push(
          await appWindow.onScaleChanged(({ payload }) => {
            scaleFactorRef.current = payload.scaleFactor;
          }),
        );
        unlisteners.push(
          await webviewApi.getCurrentWebview().onDragDropEvent(({ payload }) => {
            if (nativeEgressRef.current || stateRef.current.phase === "native-egress") return;
            if (payload.type === "leave") return cancel();
            const point = physicalToClientPoint(
              payload.position,
              scaleFactorRef.current,
              getAppliedAppZoom(),
            );
            if (payload.type === "enter") {
              const dragPayload: ExplorerDragPayload = {
                sessionId: crypto.randomUUID(),
                origin: "external",
                items: payload.paths.map((path) => ({
                  path,
                  name: fileName(path),
                  isDirectory: false,
                })),
              };
              stateRef.current = {
                ...initialState,
                phase: "external",
                payload: dragPayload,
                pointer: point,
              };
              setState(stateRef.current);
              setWebviewDragActive(true);
            }
            scheduleHitTest(point.x, point.y);
            if (payload.type === "drop") window.requestAnimationFrame(() => void performDrop());
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [cancel, performDrop, scheduleHitTest]);

  useEffect(() => () => cancel(), [cancel]);

  const value = useMemo<ExplorerDragContextValue>(
    () => ({ state, armSource, registerZone, cancel }),
    [armSource, cancel, registerZone, state],
  );
  return (
    <ExplorerDragContext.Provider value={value}>
      {props.children}
      {state.payload && state.phase !== "native-egress" ? (
        <DragInteractionShield data-explorer-drag-interaction-shield="true" />
      ) : null}
      <ExplorerDragPreview state={state} />
      <div className="sr-only" role="status" aria-live="polite">
        {dragAnnouncement(state)}
      </div>
    </ExplorerDragContext.Provider>
  );
}

export function useExplorerDragSource(items: ExplorerDragItem[]) {
  const context = useContext(ExplorerDragContext);
  const dragging = Boolean(
    context?.state.payload?.origin === "internal" &&
    items.some((item) =>
      context.state.payload?.items.some((dragged) => dragged.entryId === item.entryId),
    ),
  );
  return useMemo(
    () => ({
      onPointerDown: context
        ? (event: ReactPointerEvent<HTMLElement>) => context.armSource(items, event)
        : undefined,
      dragging,
    }),
    [context, dragging, items],
  );
}

export function useExplorerDropZone(spec: ExplorerDropZoneSpec) {
  const context = useContext(ExplorerDragContext);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const registerZone = context?.registerZone;
  useLayoutEffect(
    () => (element && registerZone ? registerZone(element, spec) : undefined),
    [element, registerZone, spec],
  );
  const active = context?.state.activeZoneId === spec.id;
  return { ref: setElement, active, valid: active && context?.state.acceptance?.valid === true };
}

export function Droppable(
  props: HTMLAttributes<HTMLDivElement> & { zone: ExplorerDropZoneSpec; children: ReactNode },
) {
  const { zone, children, className, ...rest } = props;
  const drop = useExplorerDropZone(zone);
  return (
    <div {...rest} ref={drop.ref} className={className}>
      {children}
    </div>
  );
}

export function useExplorerDropRegistry() {
  return useContext(ExplorerDragContext)?.registerZone ?? null;
}

function modifiersFromEvent(
  event: Pick<PointerEvent | KeyboardEvent | ReactPointerEvent, "altKey" | "ctrlKey" | "shiftKey">,
): ExplorerDragModifiers {
  return { copyRequested: event.altKey || event.ctrlKey, moveRequested: event.shiftKey };
}

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest("button,input,textarea,select,a,[contenteditable=true],.inline-name-editor"),
    )
  );
}

function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function autoScrollAt(x: number, y: number): void {
  if (typeof document.elementsFromPoint !== "function") return;
  const container = document
    .elementsFromPoint(x, y)
    .map((element) => element.closest<HTMLElement>("[data-explorer-scroll-container]"))
    .find(Boolean);
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const vertical = edgeScrollDelta(y, rect.top, rect.bottom, EDGE_SCROLL_SIZE);
  const horizontal = edgeScrollDelta(x, rect.left, rect.right, EDGE_SCROLL_SIZE);
  if (vertical || horizontal) container.scrollBy({ top: vertical, left: horizontal });
}

function dragPreviewDataUrl(items: ExplorerDragItem[]): string {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  if (!context) return "data:image/png;base64,";
  context.fillStyle = "rgba(20,22,26,.94)";
  context.roundRect(4, 4, 120, 72, 14);
  context.fill();
  context.fillStyle = "#f5c451";
  context.fillRect(17, 22, 28, 24);
  context.fillStyle = "#f4f4f5";
  context.font = "600 13px sans-serif";
  context.fillText(
    items.length > 1 ? `${items.length} items` : (items[0]?.name ?? "Item"),
    54,
    39,
    62,
  );
  return canvas.toDataURL("image/png");
}

function refreshExplorerPanes(): void {
  const store = useExplorerStore.getState();
  Object.keys(store.panes).forEach((paneId) => void store.refreshPane(paneId));
}
