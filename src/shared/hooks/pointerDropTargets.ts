import { useEffect, useRef, type RefObject } from "react";

export type ReorderDrag = {
  id: string;
  label: string;
  scope: string;
  paneId?: string;
  ids?: string[];
};
export type ReorderHit = {
  id: string;
  after: boolean;
  rect: DOMRect;
  previewRect?: DOMRect;
  axis: "x" | "y";
  /** Highlight the whole region (dropping into it) instead of an insertion line. */
  box?: boolean;
};
export type DropTarget = {
  element: HTMLElement;
  scope: string;
  hit(x: number, y: number, drag: ReorderDrag): ReorderHit | null;
  drop(drag: ReorderDrag, hit: ReorderHit): void;
};
export const dropTargets = new Set<DropTarget>();
export const contains = (r: DOMRect, x: number, y: number) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export function visibleRect(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  let left = bounds.left,
    right = bounds.right,
    top = bounds.top,
    bottom = bounds.bottom;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent),
      rect = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
  }
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** Pointer-only gestures never enter Tauri's native file/HTML drag loop. */
export function usePointerDropTarget(
  ref: RefObject<HTMLElement | null>,
  options: Omit<DropTarget, "element">,
) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const target: DropTarget = {
      element,
      scope: options.scope,
      hit: (...args) => latest.current.hit(...args),
      drop: (...args) => latest.current.drop(...args),
    };
    dropTargets.add(target);
    return () => {
      dropTargets.delete(target);
    };
  }, [ref, options.scope]);
}
