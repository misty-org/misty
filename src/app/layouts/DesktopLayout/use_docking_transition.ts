import { useLayoutEffect, useRef, type RefObject } from "react";
import { browserRuntimeResumeEvent, setBrowserWebviewsSuspended } from "@/features/app-windows";
import { dockingMotion } from "./docking_geometry";

const surfaces = ".misty-workspace-tabs, [data-workspace-panes] > [role='tabpanel']:not([hidden])";

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
          const remeasure = () => window.dispatchEvent(new Event(browserRuntimeResumeEvent));
          requestAnimationFrame(() => requestAnimationFrame(remeasure));
          window.setTimeout(remeasure, 400);
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
