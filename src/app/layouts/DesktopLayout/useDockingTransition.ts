import { useLayoutEffect, useRef, type RefObject } from "react";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { dockingMotion } from "./dockingGeometry";

const surfaces =
  ".misty-docking-nav, .misty-workspace-tabs, [data-workspace-panes] > [role='tabpanel']:not([hidden])";

/** Move existing chrome to its new edge without replacing any workspace subtree.
 * Native webviews stay hidden until both CSS tracks and chrome motion settle. */
export function useDockingTransition(ref: RefObject<HTMLElement | null>, layoutKey: string) {
  const previous = useRef(new Map<Element, DOMRect>());
  const previousKey = useRef(layoutKey);
  useLayoutEffect(() => {
    const shell = ref.current;
    if (!shell) return;
    let cancelled = false;
    let frame = 0;
    let moving = false;
    const animations: Animation[] = [];
    const elements = Array.from(shell.querySelectorAll<HTMLElement>(surfaces));
    const changed = previousKey.current !== layoutKey;
    previousKey.current = layoutKey;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (changed) {
      moving = true;
      setBrowserWebviewsSuspended(true, "docking-layout");
      for (const element of elements) {
        const before = previous.current.get(element);
        const after = element.getBoundingClientRect();
        if (
          !before ||
          !after.width ||
          !after.height ||
          !element.animate ||
          reducedMotion ||
          element.inert
        )
          continue;
        // Track resizing is already animated by CSS. Only animate relocation
        // when changing edges; never scale text, icons or embedded surfaces.
        const x = before.left - after.left;
        const y = before.top - after.top;
        if (x || y)
          animations.push(
            element.animate(
              [{ translate: `${x}px ${y}px` }, { translate: "0px 0px" }],
              dockingMotion,
            ),
          );
      }
      // Wait for style/layout to register CSS transitions as well as WAAPI.
      frame = requestAnimationFrame(() => {
        const pending = [
          ...animations,
          ...[shell, ...elements].flatMap((element) => element.getAnimations?.() ?? []),
        ];
        void Promise.allSettled(
          pending
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished),
        ).then(() => {
          if (cancelled) return;
          moving = false;
          remember();
          setBrowserWebviewsSuspended(false, "docking-layout");
        });
      });
    }
    function remember() {
      previous.current = new Map(
        elements.map((element) => [element, element.getBoundingClientRect()]),
      );
    }
    if (!changed) remember();
    const observer = new ResizeObserver(() => {
      if (!moving) remember();
    });
    elements.forEach((element) => observer.observe(element));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      setBrowserWebviewsSuspended(false, "docking-layout");
    };
  }, [ref, layoutKey]);
}
