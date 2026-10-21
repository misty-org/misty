import { useCallback, useEffect, useRef, useState } from "react";
import { SpaceRow } from "@/features/spaces";
import { useSpaceBarAlignment, useSpaceBarAutoHide } from "./useSpaceBarAutoHide";

/** How long the bar waits after the pointer leaves before it tucks away again. */
const hideDelay = 500;
/** The bar's own height; the page's top margin below it is the gap to the page. */
const barHeight = 36;

/**
 * The Space bar above the browser area in vertical layouts: the Space with its menu, and its
 * pages. Pinned it always takes its height. With auto-hide it takes none until the pointer
 * reaches the top edge, then pushes the page down like any panel and gives the room back
 * once the pointer has left.
 */
export function SpaceBar(props: { gridColumn: number }) {
  const autoHide = useSpaceBarAutoHide();
  const alignment = useSpaceBarAlignment();
  const [revealed, setRevealed] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const open = !autoHide || revealed;

  const cancelHide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const hideSoon = useCallback(() => {
    cancelHide();
    const attempt = () => {
      // An open menu or a focused control keeps the bar where it is.
      const element = bar.current;
      if (element?.matches(":focus-within") || element?.querySelector('[data-state="open"]')) {
        timer.current = window.setTimeout(attempt, hideDelay);
        return;
      }
      timer.current = undefined;
      setRevealed(false);
    };
    timer.current = window.setTimeout(attempt, hideDelay);
  }, [cancelHide]);
  const reveal = useCallback(() => {
    cancelHide();
    setRevealed(true);
  }, [cancelHide]);

  useEffect(() => cancelHide, [cancelHide]);
  useEffect(() => {
    if (!autoHide) {
      cancelHide();
      setRevealed(false);
    }
  }, [autoHide, cancelHide]);

  return (
    <div
      className="relative min-w-0 overflow-visible bg-[var(--misty-window-chrome,var(--misty-theme-workspace))] transition-[height] duration-150 ease-out motion-reduce:transition-none"
      style={{
        gridColumn: props.gridColumn,
        gridRow: 1,
        height: open ? `calc(var(--pane-frame, 6px) + ${barHeight}px)` : 0,
      }}
      data-space-bar={open ? "open" : "hidden"}
      onPointerEnter={autoHide ? reveal : undefined}
      onPointerLeave={autoHide ? hideSoon : undefined}
      onFocusCapture={autoHide ? reveal : undefined}
      onBlurCapture={autoHide ? hideSoon : undefined}
    >
      {autoHide && !open ? (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 z-10 flex h-[var(--pane-frame,6px)] justify-center"
        >
          <span className="mt-0.5 h-[3px] w-16 rounded-full bg-charcoal-border" />
        </div>
      ) : null}
      <div
        ref={bar}
        className="mx-[var(--pane-frame,6px)] mt-[var(--pane-frame,6px)] overflow-hidden rounded-lg border border-charcoal-border bg-[var(--workspace-tab-surface)]"
        style={{ height: barHeight }}
        inert={open ? undefined : true}
        aria-hidden={open ? undefined : true}
        // Empty space in the bar moves the window and a double press zooms it, as the tab strip
        // does; the buttons inside keep their own presses.
        data-misty-window-titlebar-region="true"
      >
        <SpaceRow alignment={alignment} />
      </div>
    </div>
  );
}
