import { dockLeaves, dockPaneBounds, removeDockLeaf } from "./dockTree";
import type { WorkspaceDockNode } from "./model";

/** A reversible visual lift; no store updates or app remounts during the gesture. */
export function liftPanePresentation(root: WorkspaceDockNode, paneId: string): () => void {
  const remaining = removeDockLeaf(root, paneId);
  if (!remaining) return () => {};
  const entries = dockLeaves(root)
    .map((pane) => ({
      pane,
      element: [...document.querySelectorAll<HTMLElement>("[data-workspace-pane]")].find(
        (element) => element.dataset.workspacePane === pane.id,
      ),
    }))
    .filter((entry): entry is typeof entry & { element: HTMLElement } => !!entry.element);
  if (!entries.length) return () => {};
  const rects = entries.map((entry) => entry.element.getBoundingClientRect());
  const x = Math.min(...rects.map((r) => r.left)),
    y = Math.min(...rects.map((r) => r.top));
  const bounds = {
    x,
    y,
    width: Math.max(...rects.map((r) => r.right)) - x,
    height: Math.max(...rects.map((r) => r.bottom)) - y,
  };
  const saved = new Map<HTMLElement, string | null>();
  const save = (element: HTMLElement) => {
    if (!saved.has(element)) saved.set(element, element.getAttribute("style"));
  };
  for (const { element } of entries) {
    for (
      let parent = element.parentElement;
      parent && !parent.hasAttribute("data-misty-desktop-frame");
      parent = parent.parentElement
    ) {
      save(parent);
      parent.style.overflow = "visible";
    }
  }
  entries.forEach(({ pane, element }) => {
    const rect = dockPaneBounds(remaining, pane.id, bounds);
    save(element);
    if (!rect) {
      element.style.visibility = "hidden";
      return;
    }
    // Fixed coordinates are expressed in the document's CSS pixels under app zoom.
    const zoom = element.offsetWidth
      ? element.getBoundingClientRect().width / element.offsetWidth
      : 1;
    Object.assign(element.style, {
      position: "fixed",
      left: `${rect.x / zoom}px`,
      top: `${rect.y / zoom}px`,
      width: `${rect.width / zoom}px`,
      height: `${rect.height / zoom}px`,
      zIndex: "100",
      overflow: "hidden",
    });
  });
  return () =>
    saved.forEach((style, element) => {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    });
}
