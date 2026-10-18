import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dockLeaves, useWorkspaceStore, type WorkspacePane } from "@/features/workspace";
import { liftPanePresentation } from "@/features/workspace/paneDragPresentation";
import { usePointerDrag } from "@/shared/hooks/usePointerReorder";
import { paneViewLabel } from "@/features/workspace/layoutTabs";
import { usePaneSwapMode, type PaneSwapDirection } from "@/features/workspace/paneSwapMode";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn, Portal } from "@/shared/ui";

const arrowDirections: Record<string, PaneSwapDirection> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function paneRect(id: string): DOMRect | null {
  const element = document.querySelector<HTMLElement>(`[data-workspace-pane="${CSS.escape(id)}"]`);
  return element?.getBoundingClientRect() ?? null;
}

/**
 * Swap mode: the arrow keys choose which pane trades places with the focused
 * one, Enter swaps, Escape leaves. A native page draws above the app, so the
 * mode raises the app layer while it is on and takes keyboard focus off any page.
 */
export function PaneSwapMode() {
  const sourceId = usePaneSwapMode((state) => state.sourceId);
  const targetId = usePaneSwapMode((state) => state.targetId);
  const active = sourceId !== null;
  const [, rerender] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!active) return;
    const { move, confirm, cancel } = usePaneSwapMode.getState();
    setBrowserWebviewsSuspended(true, "pane-swap");
    if (hasTauriInternals())
      void getCurrentWebview()
        .setFocus()
        .catch(() => undefined);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = arrowDirections[event.key];
      if (direction) move(direction);
      else if (event.key === "Enter") confirm();
      else if (event.key === "Escape") cancel();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    // A pane that closes, or a layout that rebuilds, ends the mode.
    const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
      if (state.layout.root === previous.layout.root) return;
      const ids = dockLeaves(state.layout.root).map((pane) => pane.id);
      const { sourceId: source, targetId: target } = usePaneSwapMode.getState();
      if (source && (!ids.includes(source) || (target && !ids.includes(target)))) cancel();
    });
    const redraw = () => rerender((value) => value + 1);
    // A drag started from a pane ends the mode when it is dropped or cancelled.
    const dragged = (event: Event) => {
      const dragging = (event as CustomEvent<boolean>).detail;
      setDragging(dragging);
      if (!dragging) cancel();
    };
    window.addEventListener("misty:pointer-reorder", dragged);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", redraw);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", redraw);
      window.removeEventListener("misty:pointer-reorder", dragged);
      setDragging(false);
      unsubscribe();
      setBrowserWebviewsSuspended(false, "pane-swap");
    };
  }, [active]);

  if (!sourceId) return null;
  const source = dragging ? null : paneRect(sourceId);
  const target = !dragging && targetId ? paneRect(targetId) : null;
  const panes = dockLeaves(useWorkspaceStore.getState().layout.root);
  return (
    <Portal>
      {panes.map((pane) => (
        <PaneDragSurface key={pane.id} pane={pane} rect={paneRect(pane.id)} passive={dragging} />
      ))}
      {source && <PaneOutline rect={source} tone="source" />}
      {target && targetId && <PaneOutline rect={target} tone="target" />}
      {/* Spoken to screen readers only; sighted people see the outlines move. */}
      <div role="status" className="sr-only">
        Drag any pane, or arrow keys choose. Enter swaps. Escape cancels.
      </div>
    </Portal>
  );
}

function PaneOutline({ rect, tone }: { rect: DOMRect; tone: "source" | "target" }) {
  return (
    <div
      aria-hidden="true"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      className={cn(
        "pointer-events-none fixed rounded-md border-2 layer-blocking-popup",
        tone === "target"
          ? "border-cream bg-cream/10"
          : "border-dashed border-cream/50 bg-charcoal-bg/40",
      )}
    />
  );
}

/** Covers a pane while the mode is on, so a press anywhere on it (even over a native page)
 * picks the pane up instead of reaching the page. */
function PaneDragSurface({
  pane,
  rect,
  passive,
}: {
  pane: WorkspacePane;
  rect: DOMRect | null;
  passive: boolean;
}) {
  const root = useWorkspaceStore((state) => state.layout.root);
  const drag = usePointerDrag(
    {
      id: pane.id,
      paneId: pane.id,
      label: paneViewLabel(pane.views.find((view) => view.id === pane.activeViewId) ?? pane.views[0]),
      scope: "workspace-panes",
    },
    () => liftPanePresentation(root, pane.id),
  );
  if (!rect) return null;
  return (
    <div
      data-reorder-handle
      onPointerDown={drag}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      className={cn(
        "fixed cursor-grab touch-none layer-blocking-popup active:cursor-grabbing",
        // The pressed surface stays mounted for the whole gesture; it just stops catching hits.
        passive && "pointer-events-none",
      )}
    />
  );
}
