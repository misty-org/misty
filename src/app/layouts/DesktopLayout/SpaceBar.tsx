import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SpaceRow } from "@/features/spaces";
import {
  browserRuntimeResumeEvent,
  setBrowserPointerTrackingEnabled,
} from "@/features/webviews/browserRuntime";
import { beginBrowserSlide, endBrowserSlide } from "@/features/webviews/browserSlide";
import { useSpaceBarAlignment, useSpaceBarAutoHide } from "./useSpaceBarAutoHide";

/** How long the bar waits after the pointer leaves before it tucks away again. */
const hideDelay = 500;
/** How long the pointer rests on the top edge before the bar comes out, so a pointer passing
 * over the edge on its way out of the window does not push the page down and back. */
const revealDelay = 80;
/** The strip along the top edge that brings the bar out. */
const edgeZone = 6;
/** The bar's own height; the page's top margin below it is the gap to the page. */
const barHeight = 36;
/** The slide's length. The page below keeps its full size and moves its top edge with it. */
const slideMs = 150;
const openHeight = `calc(var(--pane-frame, 6px) + ${barHeight}px)`;
const closedHeight = "0px";

/**
 * The Space bar above the browser area in vertical layouts: the Space with its menu, and its
 * pages. Pinned it always takes its height. With auto-hide it takes none until the pointer
 * rests on the top edge, then pushes the page down like any panel and gives the room back
 * once the pointer has left.
 *
 * The pointer is followed by position rather than by enter and leave: the sidebar's window
 * drag band lies over the top of the row, and native pages swallow pointer events, so neither
 * would report the pointer reliably.
 */
export function SpaceBar(props: { gridColumn: number }) {
  const autoHide = useSpaceBarAutoHide();
  const alignment = useSpaceBarAlignment();
  const [revealed, setRevealed] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const revealedRef = useRef(false);
  const pointerInside = useRef(false);
  const open = !autoHide || revealed;
  revealedRef.current = revealed;

  // The page grows to its tucked-away size while the bar waits to leave, so the strip it uncovers
  // as the bar slides away has already been painted instead of showing blank for a frame or
  // more. It is clipped by the window until then.
  const preparing = useRef(false);
  const prepare = useCallback((on: boolean) => {
    if (preparing.current === on) return;
    preparing.current = on;
    if (on) beginBrowserSlide(row.current);
    else endBrowserSlide();
    window.dispatchEvent(new Event(browserRuntimeResumeEvent));
  }, []);
  const cancelTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    prepare(false);
  }, [prepare]);
  const hideSoon = useCallback(() => {
    cancelTimer();
    if (!revealedRef.current) return;
    prepare(true);
    const attempt = () => {
      // The pointer back on the bar, an open menu or a focused control keeps it where it is.
      const element = bar.current;
      if (
        pointerInside.current ||
        element?.matches(":focus-within") ||
        element?.querySelector('[data-state="open"]')
      ) {
        // Staying: the page gets its true size back and the wait starts over.
        timer.current = window.setTimeout(hideSoon, hideDelay);
        prepare(false);
        return;
      }
      timer.current = undefined;
      // Leaving: the slide below carries on from the grown page.
      preparing.current = false;
      setRevealed(false);
    };
    timer.current = window.setTimeout(attempt, hideDelay);
  }, [cancelTimer, prepare]);
  const reveal = useCallback(() => {
    cancelTimer();
    setRevealed(true);
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);
  useEffect(() => {
    if (autoHide) return;
    cancelTimer();
    pointerInside.current = false;
    setRevealed(false);
  }, [autoHide, cancelTimer]);

  useEffect(() => {
    if (!autoHide) return;
    const move = (x: number, y: number) => {
      const bounds = row.current?.getBoundingClientRect();
      if (!bounds) return;
      const across = x >= bounds.left && x < bounds.right;
      // Tucked away only the edge counts; out, the whole bar down to its bottom does.
      const inside = revealedRef.current
        ? across && y >= bounds.top && y < bounds.bottom
        : across && y >= bounds.top && y < bounds.top + edgeZone;
      const wasInside = pointerInside.current;
      pointerInside.current = inside;
      if (inside === wasInside) return;
      if (!inside) {
        if (revealedRef.current) hideSoon();
        else cancelTimer();
      } else if (revealedRef.current) {
        cancelTimer();
      } else {
        cancelTimer();
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          if (pointerInside.current) setRevealed(true);
        }, revealDelay);
      }
    };
    const leave = () => {
      if (!pointerInside.current) return;
      pointerInside.current = false;
      if (revealedRef.current) hideSoon();
      else cancelTimer();
    };
    const pointer = (event: PointerEvent) => move(event.clientX, event.clientY);
    // Leaving the window, or entering a native page, which reports itself below.
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) leave();
    };
    const nativePointer = (event: Event) => {
      const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (Number.isFinite(x) && Number.isFinite(y)) move(x, y);
    };
    window.addEventListener("pointermove", pointer);
    document.addEventListener("pointerout", out);
    window.addEventListener("misty:browser-pointer", nativePointer);
    window.addEventListener("blur", leave);
    setBrowserPointerTrackingEnabled(true);
    return () => {
      window.removeEventListener("pointermove", pointer);
      document.removeEventListener("pointerout", out);
      window.removeEventListener("misty:browser-pointer", nativePointer);
      window.removeEventListener("blur", leave);
      setBrowserPointerTrackingEnabled(false);
      pointerInside.current = false;
    };
  }, [autoHide, cancelTimer, hideSoon]);

  // The bar's height is animated here, not by a CSS transition: at a constant speed, in whole
  // physical pixels. The native page follows the row a frame behind, and the gap it leaves is
  // as tall as the row moves in one frame, so an even, slower pace keeps it smallest, and whole
  // pixels keep the row's edge and the page's from landing a fraction apart (a thin line).
  // The page keeps the size it has with the bar tucked away meanwhile, and only its top edge
  // follows (browserSlide.ts); it takes its true size once the slide has ended.
  const shown = useRef(open);
  const lastHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measured = element.getBoundingClientRect().height;
    if (lastHeight.current === null) lastHeight.current = measured;
    if (shown.current === open) return;
    shown.current = open;
    const from = lastHeight.current;
    // React has applied the new height by now, so the row measures what it is going to be.
    const to = measured;
    lastHeight.current = to;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || from === to) {
      // Nothing to slide, but the page may have been grown ahead of it.
      endBrowserSlide();
      return;
    }
    const settled = open ? openHeight : closedHeight;
    const density = window.devicePixelRatio || 1;
    element.style.height = `${from}px`;
    beginBrowserSlide(element);
    window.dispatchEvent(new Event(browserRuntimeResumeEvent));
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / slideMs);
      const height = Math.round((from + (to - from) * progress) * density) / density;
      lastHeight.current = height;
      if (progress < 1) {
        element.style.height = `${height}px`;
        frame = window.requestAnimationFrame(step);
        return;
      }
      element.style.height = settled;
      lastHeight.current = to;
      endBrowserSlide();
      window.dispatchEvent(new Event(browserRuntimeResumeEvent));
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => endBrowserSlide, []);

  return (
    <div
      ref={row}
      className="relative min-w-0 overflow-visible bg-[var(--misty-window-chrome,var(--misty-theme-workspace))]"
      style={{
        gridColumn: props.gridColumn,
        gridRow: 1,
        height: open ? openHeight : closedHeight,
      }}
      data-space-bar={open ? "open" : "hidden"}
      onFocusCapture={autoHide ? reveal : undefined}
      onBlurCapture={autoHide ? hideSoon : undefined}
    >
      {autoHide ? (
        // The handle lies over the page's top margin, above the page panel and the sidebar's
        // drag band. It stays mounted, fading out while the bar is out, so nothing pops in over
        // the bar as it slides away; it moves the window like the band beneath it.
        <div
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 z-20 flex h-[var(--pane-frame,6px)] justify-center transition-opacity ease-out motion-reduce:transition-none ${
            open ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
          style={{ transitionDuration: `${slideMs}ms` }}
          data-space-bar-handle=""
          data-misty-window-titlebar-region="true"
        >
          <span className="mt-0.5 h-[3px] w-16 rounded-full bg-charcoal-border" />
        </div>
      ) : null}
      {/* Clipped to the row's height and held to its bottom, so the bar slides down from the
          top edge with the page instead of being cut off from below, and never draws over the
          page while it is tucked away or sliding. */}
      <div className="flex h-full flex-col justify-end overflow-hidden">
        <div
          ref={bar}
          className={
            "mx-[var(--pane-frame,6px)] mt-[var(--pane-frame,6px)] shrink-0 overflow-hidden " +
            "rounded-lg border border-charcoal-border bg-[var(--workspace-tab-surface)]"
          }
          style={{ height: barHeight }}
          inert={open ? undefined : true}
          aria-hidden={open ? undefined : true}
          // Empty space in the bar moves the window and a double press zooms it, as the tab
          // strip does; the buttons inside keep their own presses.
          data-misty-window-titlebar-region="true"
        >
          <SpaceRow alignment={alignment} />
        </div>
      </div>
    </div>
  );
}
