import { useEffect, useRef, type RefObject } from "react";

/** Horizontal travel, in wheel delta pixels, that switches one virtual window. */
const threshold = 140;
/** A pause this long ends a gesture; one gesture switches at most once. */
const gestureGapMs = 220;

/**
 * A two-finger horizontal swipe on the tab strip moves to the next or previous
 * virtual window, like switching Spaces in Arc. While the tabs themselves can
 * scroll that way, the swipe scrolls them instead.
 */
export function useWindowSwipe(
  strip: RefObject<HTMLElement | null>,
  tabList: RefObject<HTMLElement | null>,
  windows: readonly { id: string }[],
  activeId: string | null | undefined,
  onSelect: (id: string) => void,
) {
  const latest = useRef<(direction: 1 | -1) => void>(() => {});
  latest.current = (direction) => {
    const index = windows.findIndex((window) => window.id === activeId);
    const next = windows[index + direction];
    if (index >= 0 && next) onSelect(next.id);
  };
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    let travel = 0;
    let lastEvent = 0;
    let switched = false;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || event.ctrlKey) return;
      const now = event.timeStamp;
      if (now - lastEvent > gestureGapMs) {
        travel = 0;
        switched = false;
      }
      lastEvent = now;
      const list = tabList.current;
      const scrollable =
        list &&
        (event.deltaX > 0
          ? list.scrollLeft + list.clientWidth < list.scrollWidth - 1
          : list.scrollLeft > 0);
      if (scrollable || switched) return;
      travel += event.deltaX;
      if (Math.abs(travel) < threshold) return;
      switched = true;
      latest.current(travel > 0 ? 1 : -1);
    };
    element.addEventListener("wheel", wheel, { passive: true });
    return () => element.removeEventListener("wheel", wheel);
  }, [strip, tabList]);
}
