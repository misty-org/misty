// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from Fluxer (https://github.com/fluxerapp/fluxer): fluxer_app/src/features/ui/components/
// Scroller.tsx, ui/scroller/ScrollerTrack.tsx, ScrollerMath.ts and useScrollerThumb.ts, cut down to
// the vertical overlay track Space chat uses.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type UIEventHandler,
} from "react";
import s from "./css/Scroller.module.css";
import t from "./css/ScrollerTrack.module.css";
import { cx } from "./cx";

/** How long the thin track stays after the last scroll, as in Fluxer. */
const FADE_AFTER_MS = 1000;

/**
 * Fluxer's scroller: the native scrollbar hidden, a pill thumb drawn over the content. `thin`
 * (channel and member lists) is a 4px thumb that shows on hover, scroll or drag; `regular` (the
 * messages) is 8px and always shown.
 */
export const FluxerScroller = forwardRef<
  HTMLDivElement,
  {
    className?: string;
    wrapClassName?: string;
    scrollbar?: "thin" | "regular";
    fade?: boolean;
    onScroll?: UIEventHandler<HTMLDivElement>;
    children: ReactNode;
    "aria-label"?: string;
    role?: string;
  }
>(function FluxerScroller(
  { className, wrapClassName, scrollbar = "thin", fade = true, onScroll, children, ...rest },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scroller.current as HTMLDivElement);
  const minThumb = scrollbar === "regular" ? 40 : 24;
  const [hasTrack, setHasTrack] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const geometry = useRef({ thumbSize: 0, trackSize: 0, max: 0 });

  const update = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const viewport = element.clientHeight;
    const content = element.scrollHeight;
    const max = Math.max(0, content - viewport);
    setHasTrack(max > 0);
    if (max <= 0) return;
    const thumbSize = Math.min(viewport, Math.max(minThumb, (viewport / content) * viewport));
    const offset = (viewport - thumbSize) * Math.min(1, Math.max(0, element.scrollTop / max));
    geometry.current = { thumbSize, trackSize: viewport, max };
    if (thumb.current) {
      thumb.current.style.height = `${thumbSize}px`;
      thumb.current.style.transform = `translate3d(0, ${offset}px, 0)`;
    }
  }, [minThumb]);

  useLayoutEffect(update, [update, hasTrack]);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of Array.from(element.children)) observer.observe(child);
      update();
    });
    mutations.observe(element, { childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [update]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const scrolled: UIEventHandler<HTMLDivElement> = (event) => {
    update();
    setScrolling(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setScrolling(false), FADE_AFTER_MS);
    onScroll?.(event);
  };

  const drag = (event: ReactPointerEvent<HTMLDivElement>, startOffset?: number) => {
    const element = scroller.current;
    if (!element || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const { thumbSize, trackSize, max } = geometry.current;
    const ratio = max / Math.max(1, trackSize - thumbSize);
    if (startOffset !== undefined) element.scrollTop = (startOffset - thumbSize / 2) * ratio;
    const startY = event.clientY;
    const startTop = element.scrollTop;
    setDragging(true);
    const move = (next: PointerEvent) => {
      element.scrollTop = startTop + (next.clientY - startY) * ratio;
    };
    const end = () => {
      setDragging(false);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const visible = !fade || hovered || scrolling || dragging;
  return (
    <div
      className={cx(s.scrollerWrap, scrollbar === "regular" && s.regular, wrapClassName)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        ref={scroller}
        className={cx(s.scroller, dragging && s.dragging, className)}
        onScroll={scrolled}
        {...rest}
      >
        {children}
      </div>
      {hasTrack ? (
        <div
          role="presentation"
          className={cx(
            t.track,
            t.vertical,
            scrollbar === "regular" && t.regular,
            visible && t.visible,
          )}
          style={{ pointerEvents: visible ? "auto" : "none" }}
          onPointerDown={(event) =>
            drag(event, event.clientY - event.currentTarget.getBoundingClientRect().top)
          }
        >
          <div
            ref={thumb}
            role="presentation"
            className={cx(t.thumb, dragging && t.active)}
            onPointerDown={(event) => drag(event)}
          />
        </div>
      ) : null}
    </div>
  );
});
