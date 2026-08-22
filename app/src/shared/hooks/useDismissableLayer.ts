import { useEffect, useRef, type RefObject } from "react";

export function useDismissableLayer(options: {
  active: boolean;
  layerRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  const { active, layerRef, onDismiss } = options;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const layer = layerRef.current;
      if (layer && event.composedPath().includes(layer)) return;
      onDismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
