import type {
  UseBoundedFloatingOptions,
  BoundedFloatingResult,
} from "@/models/interfaces/hooks/useBoundedFloating";
export type {
  UseBoundedFloatingOptions,
  BoundedFloatingResult,
} from "@/models/interfaces/hooks/useBoundedFloating";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

const hiddenStyle: CSSProperties = {
  position: "fixed",
  left: 0,
  top: 0,
  visibility: "hidden",
};

export function useBoundedFloating(options: UseBoundedFloatingOptions): BoundedFloatingResult {
  const floatingRef = useRef<HTMLDivElement>(null);
  const [floatingStyle, setFloatingStyle] = useState<CSSProperties>(hiddenStyle);
  const [opensAbove, setOpensAbove] = useState(false);
  const align = options.align ?? "start";
  const gap = options.gap ?? 6;
  const viewportPadding = options.viewportPadding ?? 8;
  const preferredMaxHeight = options.preferredMaxHeight ?? 288;
  const minimumUsefulHeight = options.minimumUsefulHeight ?? 96;
  const matchAnchorWidth = options.matchAnchorWidth ?? true;

  const updatePosition = useCallback(() => {
    if (!options.open) return;
    const anchor = options.anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;

    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const minLeft = viewportLeft + viewportPadding;
    const minTop = viewportTop + viewportPadding;
    const viewportRight = viewportLeft + viewportWidth - viewportPadding;
    const viewportBottom = viewportTop + viewportHeight - viewportPadding;
    const availableWidth = Math.max(0, viewportRight - minLeft);
    const anchorRect = anchor.getBoundingClientRect();
    const spaceBelow = Math.max(0, viewportBottom - anchorRect.bottom - gap);
    const spaceAbove = Math.max(0, anchorRect.top - minTop - gap);
    const nextOpensAbove = spaceBelow < minimumUsefulHeight && spaceAbove > spaceBelow;
    const availableHeight = nextOpensAbove ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(0, Math.min(preferredMaxHeight, availableHeight));
    const minWidth = matchAnchorWidth ? Math.min(anchorRect.width, availableWidth) : 0;
    const measuredWidth = Math.max(floating.scrollWidth, floating.getBoundingClientRect().width);
    const width = Math.max(minWidth, Math.min(measuredWidth, availableWidth));
    const renderedHeight = Math.min(floating.scrollHeight, maxHeight);
    const preferredLeft = align === "end" ? anchorRect.right - width : anchorRect.left;
    const left = Math.max(minLeft, Math.min(preferredLeft, viewportRight - width));
    const preferredTop = nextOpensAbove
      ? anchorRect.top - gap - renderedHeight
      : anchorRect.bottom + gap;
    const top = Math.max(minTop, Math.min(preferredTop, viewportBottom - renderedHeight));
    const nextStyle: CSSProperties = {
      position: "fixed",
      left,
      top,
      width,
      maxWidth: availableWidth,
      maxHeight,
      visibility: "visible",
    };

    setFloatingStyle((current) =>
      current.left === nextStyle.left &&
      current.top === nextStyle.top &&
      current.width === nextStyle.width &&
      current.maxWidth === nextStyle.maxWidth &&
      current.maxHeight === nextStyle.maxHeight &&
      current.visibility === "visible"
        ? current
        : nextStyle,
    );
    setOpensAbove((current) => (current === nextOpensAbove ? current : nextOpensAbove));
  }, [
    align,
    gap,
    matchAnchorWidth,
    minimumUsefulHeight,
    options.anchorRef,
    options.open,
    preferredMaxHeight,
    viewportPadding,
  ]);

  useLayoutEffect(() => {
    if (!options.open) {
      setFloatingStyle(hiddenStyle);
      setOpensAbove(false);
      return;
    }
    setFloatingStyle(hiddenStyle);
    updatePosition();
  }, [options.open, updatePosition]);

  useEffect(() => {
    if (!options.open) return;
    const anchor = options.anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchor);
    observer.observe(floating);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [options.anchorRef, options.open, updatePosition]);

  return { floatingRef, floatingStyle, opensAbove };
}
