import { useLayoutEffect, useRef, type RefObject } from "react";

const timing = { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
/** Larger changes (virtual window switches, collapsing a group) swap instantly. */
const maxAnimatedChanges = 3;

type Presence = { element: HTMLElement; next: Element | null; width: number };

/**
 * Horizontal tabs grow in when opened and collapse when closed, so neighbors
 * slide instead of jumping. Works from the DOM after each commit, so every
 * open and close path animates: buttons, shortcuts, menus and drags. A closed
 * tab's detached element returns briefly as an inert ghost while it collapses.
 */
export function useTabPresenceMotion(listRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const previous = useRef<Map<string, Presence> | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !enabled) {
      previous.current = null;
      return;
    }
    const current = new Map<string, Presence>();
    for (const element of list.querySelectorAll<HTMLElement>(":scope > [data-reorder-item]"))
      current.set(element.dataset.reorderItem!, {
        element,
        next: element.nextElementSibling,
        width: element.getBoundingClientRect().width,
      });
    const before = previous.current;
    previous.current = current;
    if (!before || reduceMotion()) return;
    const added = [...current.keys()].filter((id) => !before.has(id));
    const removed = [...before.keys()].filter((id) => !current.has(id));
    const changes = added.length + removed.length;
    if (!changes || changes > maxAnimatedChanges || added.length === current.size) return;
    for (const id of added) enter(current.get(id)!);
    // Last first, so an adjacent closed tab's ghost is already back in place
    // when an earlier ghost anchors before it.
    for (const id of removed.reverse()) exit(list, before.get(id)!);
  });
}

function enter({ element, width }: Presence) {
  if (!element.animate) return;
  element.animate(
    [
      { minWidth: "0px", maxWidth: "0px", opacity: 0 },
      { minWidth: "0px", maxWidth: `${width}px`, opacity: 1 },
    ],
    timing,
  );
}

function exit(list: HTMLElement, { element, next, width }: Presence) {
  if (!element.animate || element.isConnected) return;
  const ghost = element;
  delete ghost.dataset.reorderItem;
  delete ghost.dataset.reorderPreview;
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.style.pointerEvents = "none";
  ghost.style.overflow = "hidden";
  const anchor =
    next?.parentElement === list ? next : list.querySelector(":scope > .misty-workspace-new-tab");
  list.insertBefore(ghost, anchor);
  const animation = ghost.animate(
    [
      { minWidth: "0px", maxWidth: `${width}px`, opacity: 1 },
      { minWidth: "0px", maxWidth: "0px", opacity: 0 },
    ],
    { ...timing, fill: "forwards" },
  );
  const remove = () => ghost.remove();
  animation.onfinish = remove;
  animation.oncancel = remove;
}

function reduceMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
