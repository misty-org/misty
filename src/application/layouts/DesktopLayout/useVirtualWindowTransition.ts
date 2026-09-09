import { useLayoutEffect, useRef } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export const virtualWindowTransition = {
  duration: 240,
  easing: "cubic-bezier(0.2, 0.85, 0.25, 1)",
} as const;

export function useVirtualWindowTransition(activeVirtualWindowId: string) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const previousWindowIdRef = useRef(activeVirtualWindowId);

  useLayoutEffect(() => {
    const previousWindowId = previousWindowIdRef.current;
    previousWindowIdRef.current = activeVirtualWindowId;
    if (previousWindowId === activeVirtualWindowId) return;

    const element = elementRef.current;
    const reducedMotion = window.matchMedia?.(reducedMotionQuery).matches;
    if (!element || typeof element.animate !== "function" || reducedMotion) {
      return;
    }

    const animation = element.animate(
      [
        {
          opacity: 0.74,
          transform: "translate3d(3px, 0, 0) scale(0.998)",
          filter: "brightness(0.86) saturate(0.92)",
        },
        {
          opacity: 1,
          transform: "translate3d(0, 0, 0) scale(1)",
          filter: "brightness(1) saturate(1)",
        },
      ],
      virtualWindowTransition,
    );
    return () => {
      animation.cancel();
    };
  }, [activeVirtualWindowId]);

  return elementRef;
}
