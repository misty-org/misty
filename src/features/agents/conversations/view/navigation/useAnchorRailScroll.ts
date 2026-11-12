// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MessageAnchor } from "./timelineAnchors";

/** The element of the message an anchor marks. */
function anchorElement(root: HTMLElement, id: string): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>("[data-anchor-id]"))
    if (element.dataset.anchorId === id) return element;
  return null;
}

/** How far an element sits below the top of its scroll container's content. */
function offsetIn(container: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

/**
 * Which anchor the scroll is at, and jumping to one. Near the bottom the latest message is always
 * active, so a streaming answer doesn't churn the active dash every frame.
 */
export function useAnchorRailScroll(
  scrollRef: RefObject<HTMLElement | null>,
  anchors: MessageAnchor[],
) {
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const anchorsRef = useRef(anchors);
  useEffect(() => {
    anchorsRef.current = anchors;
  });
  useEffect(() => {
    const view = scrollRef.current;
    if (!view || anchors.length === 0) {
      setActiveAnchorId(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const list = anchorsRef.current;
      if (!list.length) return;
      if (view.scrollHeight - view.scrollTop - view.clientHeight < 24) {
        const latest = list[list.length - 1].id;
        setActiveAnchorId((previous) => (previous === latest ? previous : latest));
        return;
      }
      const line = view.scrollTop + Math.min(96, view.clientHeight * 0.32);
      let next = list[0].id;
      for (const anchor of list) {
        const element = anchorElement(view, anchor.id);
        if (element && offsetIn(view, element) <= line) next = anchor.id;
        else if (element) break;
      }
      setActiveAnchorId((previous) => (previous === next ? previous : next));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      view.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [anchors.length, scrollRef]);

  const scrollToAnchor = useCallback(
    (anchorId: string) => {
      const view = scrollRef.current;
      const element = view && anchorElement(view, anchorId);
      if (!view || !element) return;
      setActiveAnchorId(anchorId);
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      view.scrollTo({
        top: Math.max(0, offsetIn(view, element) - 16),
        behavior: reduce ? "auto" : "smooth",
      });
    },
    [scrollRef],
  );

  /** Jumps to the anchor before or after the active one. */
  const step = useCallback(
    (direction: -1 | 1) => {
      const list = anchorsRef.current;
      if (!list.length) return false;
      const index = list.findIndex((anchor) => anchor.id === activeAnchorId);
      const next =
        list[Math.max(0, Math.min(list.length - 1, (index < 0 ? list.length : index) + direction))];
      if (next) scrollToAnchor(next.id);
      return Boolean(next);
    },
    [activeAnchorId, scrollToAnchor],
  );

  return { activeAnchorId, scrollToAnchor, step };
}
