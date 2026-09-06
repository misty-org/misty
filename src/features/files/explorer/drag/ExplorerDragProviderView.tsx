import { DragInteractionShield } from "@/shared/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ExplorerDragItem,
  ExplorerDragModifiers,
  ExplorerDragPayload,
  ExplorerDragViewState,
  ExplorerDropZoneSpec,
} from "../model/interfaces/drag/types";
import { dragAnnouncement, ExplorerDragPreview, setWebviewDragActive } from "./ExplorerDragPreview";
import { ExplorerDragContext } from "./ExplorerDragState";
import type {
  ArmedDrag,
  ExplorerDragContextValue,
  PreparedEgress,
  RegisteredZone,
} from "./ExplorerDragTypes";
import {
  autoScrollAt,
  dragPreviewDataUrl,
  fileName,
  isInteractiveDragTarget,
  modifiersFromEvent,
} from "./explorerDragHelpers";
import { dragDistance, selectDropCandidate } from "./geometry";

const DRAG_THRESHOLD = 6;
const SPRING_LOAD_MS = 700;
const initialState: ExplorerDragViewState = {
  phase: "idle",
  payload: null,
  pointer: null,
  activeZoneId: null,
  acceptance: null,
  preparing: false,
  error: null,
};

export interface ExplorerDragRuntime {
  prepare: typeof import("@/features/files/native").explorerPrepareDragItems;
  cancelPreparation(sessionId: string): Promise<unknown>;
  notify(message: string): void;
  startDrag(paths: string[], icon: string, mode: "move" | "copy", done: (dropped: boolean) => void): Promise<void>;
  refresh(): void;
  subscribeNative?(listener: (event: {type: "enter" | "over" | "drop" | "leave"; position: {x: number; y: number}; paths?: string[]}) => void): Promise<() => void>;
}
export function ExplorerDragProviderView(props: { children: ReactNode; runtime: ExplorerDragRuntime }) {
  const runtime = props.runtime;
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
  const springTimerRef = useRef<number | null>(null);
  const hitFrameRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const cancel = useCallback((message?: string) => {
    const prepared = preparedRef.current;
    if (prepared && !prepared.settled)
      void runtime.cancelPreparation(prepared.sessionId).catch(() => undefined);
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
  }, [runtime]);

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
  }, [runtime]);

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
      preparation.promise = runtime.prepare({
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
            runtime.notify(`Skipped ${result.skipped.length} item(s) while preparing drag-out.`);
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
  }, [runtime]);

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
      runtime.notify(`Drop failed: ${message}`);
      cancel(message);
    }
  }, [cancel, runtime]);

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
      await runtime.startDrag(paths, dragPreviewDataUrl(current.payload.items), mode, (dropped) => {
          if (dropped && mode === "move") runtime.refresh();
          cancel();
          window.setTimeout(() => {
            nativeEgressRef.current = false;
          }, 250);
        },
      );
    } catch (error) {
      nativeEgressRef.current = false;
      const message = error instanceof Error ? error.message : String(error);
      runtime.notify(`Could not start drag-out: ${message}`);
      cancel(message);
    }
  }, [cancel, runtime]);

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
  }, [runtime]);

  useEffect(() => {
    if (!runtime.subscribeNative) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void runtime.subscribeNative(payload => {
      if (disposed || nativeEgressRef.current || stateRef.current.phase === "native-egress") return;
      if (payload.type === "leave") return cancel();
      const point = payload.position;
      if (payload.type === "enter") {
        stateRef.current = { ...initialState, phase: "external", pointer: point,
          payload: {sessionId: crypto.randomUUID(), origin: "external", items: (payload.paths ?? []).map(path => ({path, name: fileName(path), isDirectory: false}))}};
        setState(stateRef.current);
        setWebviewDragActive(true);
      }
      scheduleHitTest(point.x, point.y);
      if (payload.type === "drop") window.requestAnimationFrame(() => void performDrop());
    }).then(remove => { if (disposed) remove(); else unsubscribe = remove; }).catch(runtime.notify);
    return () => { disposed = true; unsubscribe?.(); };
  }, [cancel, performDrop, scheduleHitTest, runtime]);

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

export * from "./ExplorerDragHooks";
