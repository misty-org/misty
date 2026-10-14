import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
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

function paneTitle(id: string): string {
  const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find((leaf) => leaf.id === id);
  return paneViewLabel(pane?.views.find((view) => view.id === pane.activeViewId) ?? pane?.views[0]);
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
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", redraw);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", redraw);
      unsubscribe();
      setBrowserWebviewsSuspended(false, "pane-swap");
    };
  }, [active]);

  if (!sourceId) return null;
  const source = paneRect(sourceId);
  const target = targetId ? paneRect(targetId) : null;
  return (
    <Portal>
      {source && <PaneOutline rect={source} label={paneTitle(sourceId)} tone="source" />}
      {target && targetId && (
        <PaneOutline rect={target} label={paneTitle(targetId)} tone="target" />
      )}
      <div
        role="status"
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-6 mx-auto w-fit layer-blocking-popup",
          "rounded-md border border-charcoal-border bg-charcoal-card px-3 py-1.5",
          "text-xs text-cream shadow-lg",
        )}
      >
        Arrow keys choose a pane · Enter swaps · Esc cancels
      </div>
    </Portal>
  );
}

function PaneOutline({
  rect,
  label,
  tone,
}: {
  rect: DOMRect;
  label: string;
  tone: "source" | "target";
}) {
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
    >
      <span
        className={cn(
          "absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded px-1.5 py-0.5",
          "bg-charcoal-card text-[11px] text-cream",
        )}
      >
        {tone === "source" ? `Moving: ${label}` : `Swap with: ${label}`}
      </span>
    </div>
  );
}
