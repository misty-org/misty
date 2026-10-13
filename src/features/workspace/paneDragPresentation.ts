import { dockLeaves, dockPaneBounds, removeDockLeaf } from "./dockTree";
import type { WorkspaceDockNode } from "./model";
import { browserTabShowsInternalPage, useBrowserRuntimeStore } from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";

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
  const overlays: HTMLElement[] = [];
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
  // The layout's splitter bars belong to the arrangement being left; while the panes are lifted
  // they would cut straight through the one pane that fills the space.
  document
    .querySelectorAll<HTMLElement>("[data-panel-resize-handle-id], [data-pane-layout-resizer]")
    .forEach((handle) => {
      save(handle);
      handle.style.visibility = "hidden";
    });
  entries.forEach(({ pane, element }, index) => {
    const rect = dockPaneBounds(remaining, pane.id, bounds);
    save(element);
    if (!rect) {
      // Not just hidden: with no size its page leaves the screen too, so nothing of the dragged
      // pane stays behind in its old slot.
      element.style.display = "none";
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
    // A pane showing a live page stays transparent: the page itself is resized to the pane's new
    // rectangle as the layout reflows, so it shows through at its real size. Any other pane is
    // painted opaque so no page beneath it shows.
    const view = pane.views.find((item) => item.id === pane.activeViewId);
    const livePage =
      hasTauriInternals() &&
      view?.surfaceId === "browser" &&
      !browserTabShowsInternalPage(view.id);
    if (livePage) return;
    element.style.setProperty("background-color", "var(--color-charcoal-bg)", "important");
    // The native page can't move with the pane, so its last preview stands in for it and
    // the panes visibly rearrange with their content.
    const preview = useBrowserRuntimeStore.getState().previews[pane.activeViewId ?? ""];
    if (!preview?.dataUrl) return;
    const toolbar = element.querySelector<HTMLElement>("[data-browser-toolbar]");
    const below = toolbar ? toolbar.getBoundingClientRect().bottom - element.getBoundingClientRect().top : 0;
    const overlay = document.createElement("img");
    overlay.src = preview.dataUrl;
    overlay.alt = "";
    overlay.setAttribute("aria-hidden", "true");
    // The preview is stretched over the pane's new content area, so a pane that grows into the
    // space a lifted pane left shows its whole page there, never a cut-off corner of it. The
    // toolbar is real DOM and already follows the new width.
    const contentTop = Math.max(0, below);
    Object.assign(overlay.style, {
      position: "absolute",
      left: "0",
      top: `${contentTop / zoom}px`,
      width: `${rect.width / zoom}px`,
      height: `${Math.max(0, rect.height - contentTop) / zoom}px`,
      maxWidth: "none",
      objectFit: "fill",
      pointerEvents: "none",
    });
    element.append(overlay);
    overlays.push(overlay);
  });
  // Pages follow their pane's new size on their own; this makes sure ones that only moved do too.
  window.requestAnimationFrame(() => window.dispatchEvent(new Event("misty:workspace-geometry-changed")));
  return () => {
    overlays.forEach((overlay) => overlay.remove());
    saved.forEach((style, element) => {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    });
  };
}
