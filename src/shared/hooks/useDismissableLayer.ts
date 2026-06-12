import { useEffect, useRef, type RefObject } from "react";

export function useDismissableLayer(options: {
  active: boolean;
  layerRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  shouldIgnore?: (event: PointerEvent | KeyboardEvent) => boolean;
}) {
  const { active, layerRef, onDismiss, shouldIgnore } = options;
  const onDismissRef = useRef(onDismiss);
  const shouldIgnoreRef = useRef(shouldIgnore);
  onDismissRef.current = onDismiss;
  shouldIgnoreRef.current = shouldIgnore;

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (shouldIgnoreRef.current?.(event)) return;
      const layer = layerRef.current;
      if (layer && event.composedPath().includes(layer)) return;
      onDismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (shouldIgnoreRef.current?.(event)) return;
      event.preventDefault();
      event.stopPropagation();
      onDismissRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [active, layerRef]);
}
