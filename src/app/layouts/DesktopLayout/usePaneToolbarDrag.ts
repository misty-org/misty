import { useEffect } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { liftPanePresentation } from "@/features/workspace/paneDragPresentation";
import { dockLeaves, useWorkspaceStore, type WorkspacePane } from "@/features/workspace";
import { usePointerDrag } from "@/shared/hooks/usePointerReorder";

const CONTROL_SELECTOR =
  "button, a, input, textarea, select, [role='button'], [role='menuitem'], [contenteditable], [data-reorder-ignore]";

/**
 * With two or more panes, the empty space of a pane's toolbar moves the pane: press and drag it
 * to an edge to dock there, or to the middle to swap. Buttons and the address field keep their
 * presses. The toolbar is portaled in by the page, so the listener is native on its host.
 */
export function usePaneToolbarDrag(pane: WorkspacePane, host: HTMLElement | null) {
  const root = useWorkspaceStore((state) => state.layout.root);
  const multiple = dockLeaves(root).length >= 2;
  const drag = usePointerDrag(
    {
      id: pane.id,
      paneId: pane.id,
      label: pane.views.find((tab) => tab.id === pane.activeViewId)?.title ?? "Pane",
      scope: "workspace-panes",
    },
    () => liftPanePresentation(root, pane.id),
  );
  useEffect(() => {
    if (!host || !multiple) return;
    host.dataset.reorderHandle = "";
    host.dataset.mistyWindowDragBlock = "true";
    host.style.cursor = "grab";
    const press = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(CONTROL_SELECTOR)) return;
      useWorkspaceStore.getState().focusPane(pane.id);
      drag(event as unknown as ReactPointerEvent<HTMLElement>);
    };
    host.addEventListener("pointerdown", press);
    return () => {
      host.removeEventListener("pointerdown", press);
      delete host.dataset.reorderHandle;
      delete host.dataset.mistyWindowDragBlock;
      host.style.cursor = "";
    };
  });
}
