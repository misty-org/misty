import { useEffect, type RefObject } from "react";

const activeScrollbarClass = "misty-transient-scrollbar-active";
const transientScrollbarSelector = ".misty-transient-scrollbar";

export function useTransientScrollbars(
  rootRef: RefObject<HTMLElement | null>,
  hideDelayMs = 650,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const hideTimers = new Map<HTMLElement, number>();

    const showScrollbar = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches(transientScrollbarSelector)) return;
      target.classList.add(activeScrollbarClass);
      const previousTimer = hideTimers.get(target);
      if (previousTimer !== undefined) window.clearTimeout(previousTimer);
      hideTimers.set(
        target,
        window.setTimeout(() => {
          target.classList.remove(activeScrollbarClass);
          hideTimers.delete(target);
        }, hideDelayMs),
      );
    };

    root.addEventListener("scroll", showScrollbar, true);
    return () => {
      root.removeEventListener("scroll", showScrollbar, true);
      hideTimers.forEach((timer, element) => {
        window.clearTimeout(timer);
        element.classList.remove(activeScrollbarClass);
      });
      hideTimers.clear();
    };
  }, [hideDelayMs, rootRef]);
}
