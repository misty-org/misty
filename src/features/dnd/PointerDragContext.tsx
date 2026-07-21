import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type {
  PointerDragContextValue,
  PointerDragPayload,
  PointerDragState,
  PointerDropZoneSpec,
} from "@/models/interfaces/features/dnd/PointerDragContext";
export type {
  PointerDragPayload,
  PointerDropZoneSpec,
} from "@/models/interfaces/features/dnd/PointerDragContext";

/**
 * Pointer-driven drag and drop for in-app payloads.
 *
 * HTML5 drag and drop cannot be used inside the Tauri shell: wry installs its own
 * NSDraggingDestination on the webview to catch OS file drops, which also swallows
 * in-page drags, so `dragover`/`drop` never reach the document. This provider is
 * built on pointer events instead and is unaffected. Native OS file drops still go
 * through Tauri's `onDragDropEvent` — see ExplorerDragContext.
 */

const DRAG_THRESHOLD_PX = 5;

const initialState: PointerDragState = {
  payload: null,
  pointer: null,
  activeZoneId: "",
  preview: null,
};

/** Dragging is an enhancement: subtrees rendered outside a provider stay usable, just undraggable. */
const inertContext: PointerDragContextValue = {
  state: initialState,
  startDrag: () => undefined,
  registerZone: () => () => undefined,
  cancel: () => undefined,
};

const PointerDragContext = createContext<PointerDragContextValue>(inertContext);

export function PointerDragProvider(props: { children: ReactNode }) {
  const [state, setState] = useState<PointerDragState>(initialState);
  const stateRef = useRef(state);
  const zonesRef = useRef(new Map<HTMLElement, RefObject<PointerDropZoneSpec>>());
  const armedRef = useRef<{
    payload: PointerDragPayload;
    preview: ReactNode;
    origin: { x: number; y: number };
  } | null>(null);

  const apply = useCallback((next: PointerDragState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const cancel = useCallback(() => {
    armedRef.current = null;
    if (stateRef.current.payload === null && stateRef.current.activeZoneId === "") return;
    apply(initialState);
  }, [apply]);

  const zoneAt = useCallback((x: number, y: number, payload: PointerDragPayload) => {
    let node = document.elementFromPoint(x, y) as HTMLElement | null;
    while (node) {
      const spec = zonesRef.current.get(node)?.current;
      if (spec && spec.accepts(payload)) return spec;
      node = node.parentElement;
    }
    return null;
  }, []);

  const registerZone = useCallback((element: HTMLElement, spec: RefObject<PointerDropZoneSpec>) => {
    zonesRef.current.set(element, spec);
    return () => {
      zonesRef.current.delete(element);
    };
  }, []);

  const startDrag = useCallback<PointerDragContextValue["startDrag"]>((event, payload, preview) => {
    if (event.button !== 0 || !event.isPrimary) return;
    armedRef.current = {
      payload,
      preview: preview ?? null,
      origin: { x: event.clientX, y: event.clientY },
    };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const armed = armedRef.current;
      const dragging = stateRef.current.payload;
      if (!armed && !dragging) return;

      if (armed && !dragging) {
        const travelled =
          Math.abs(event.clientX - armed.origin.x) + Math.abs(event.clientY - armed.origin.y);
        if (travelled < DRAG_THRESHOLD_PX) return;
      }

      const payload = dragging ?? armed?.payload;
      if (!payload) return;
      // Text selection would otherwise follow the pointer through the drag.
      event.preventDefault();
      const zone = zoneAt(event.clientX, event.clientY, payload);
      apply({
        payload,
        pointer: { x: event.clientX, y: event.clientY },
        activeZoneId: zone?.id ?? "",
        preview: dragging ? stateRef.current.preview : (armed?.preview ?? null),
      });
    };

    const up = (event: PointerEvent) => {
      const payload = stateRef.current.payload;
      armedRef.current = null;
      if (!payload) return;
      const zone = zoneAt(event.clientX, event.clientY, payload);
      cancel();
      zone?.onDrop(payload);
    };

    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown);
    };
  }, [apply, cancel, zoneAt]);

  useEffect(() => {
    const dragging = Boolean(state.payload);
    if (dragging) document.documentElement.dataset.pointerDragging = "true";
    else delete document.documentElement.dataset.pointerDragging;
    return () => {
      delete document.documentElement.dataset.pointerDragging;
    };
  }, [state.payload]);

  const value = useMemo<PointerDragContextValue>(
    () => ({ state, startDrag, registerZone, cancel }),
    [cancel, registerZone, startDrag, state],
  );

  return (
    <PointerDragContext.Provider value={value}>
      {props.children}
      <PointerDragPreview state={state} />
    </PointerDragContext.Provider>
  );
}

export function usePointerDrag() {
  return useContext(PointerDragContext);
}

/** Marks an element as a drop target. Returns a ref to attach and whether it is hovered. */
export function useDropZone(spec: PointerDropZoneSpec) {
  const { registerZone, state } = usePointerDrag();
  const specRef = useRef(spec);
  specRef.current = spec;
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (element: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = element ? registerZone(element, specRef) : null;
    },
    [registerZone],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  return { ref, active: Boolean(state.payload) && state.activeZoneId === spec.id };
}

function PointerDragPreview({ state }: { state: PointerDragState }) {
  if (!state.payload || !state.pointer || !state.preview) return null;

  return (
    <div
      className="pointer-events-none fixed z-[2147483100] max-w-[320px] opacity-90 shadow-2xl"
      style={{ left: state.pointer.x + 12, top: state.pointer.y + 12 }}
      aria-hidden="true"
    >
      {state.preview}
    </div>
  );
}
