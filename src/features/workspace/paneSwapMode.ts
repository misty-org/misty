import { create } from "zustand";
import { dockLeaves } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";

export type PaneSwapDirection = "left" | "right" | "up" | "down";

interface PaneRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The pane nearest `fromId` in `direction`: its center must lie that way, and
 * a pane lined up with the current one beats a closer pane off to the side.
 */
export function paneInDirection(
  rects: PaneRect[],
  fromId: string,
  direction: PaneSwapDirection,
): string | null {
  const from = rects.find((rect) => rect.id === fromId);
  if (!from) return null;
  const center = (rect: PaneRect) => ({
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  });
  const origin = center(from);
  let best: { id: string; score: number } | null = null;
  for (const rect of rects) {
    if (rect.id === fromId) continue;
    const point = center(rect);
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const along = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const across = direction === "left" || direction === "right" ? dy : dx;
    if (along <= 0) continue;
    const score = along + Math.abs(across) * 2;
    if (!best || score < best.score) best = { id: rect.id, score };
  }
  return best?.id ?? null;
}

function paneRects(): PaneRect[] {
  const ids = dockLeaves(useWorkspaceStore.getState().layout.root).map((pane) => pane.id);
  return ids.flatMap((id) => {
    const element = document.querySelector<HTMLElement>(`[data-workspace-pane="${CSS.escape(id)}"]`);
    if (!element) return [];
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return [{ id, left, top, right, bottom }];
  });
}

interface PaneSwapState {
  /** The pane being moved, or null while swap mode is off. */
  sourceId: string | null;
  /** The pane that would trade places with it. */
  targetId: string | null;
  start(): boolean;
  move(direction: PaneSwapDirection): void;
  confirm(): void;
  cancel(): void;
}

/** A modal state: choose a pane with the arrow keys, Enter swaps, Escape leaves. */
export const usePaneSwapMode = create<PaneSwapState>((set, get) => ({
  sourceId: null,
  targetId: null,
  start() {
    const { layout } = useWorkspaceStore.getState();
    const panes = dockLeaves(layout.root);
    if (panes.length < 2) return false;
    const index = Math.max(
      0,
      panes.findIndex((pane) => pane.id === layout.focusedPaneId),
    );
    set({ sourceId: panes[index].id, targetId: panes[(index + 1) % panes.length].id });
    return true;
  },
  move(direction) {
    const { sourceId, targetId } = get();
    if (!sourceId || !targetId) return;
    // Move from the highlighted pane, so repeated presses keep travelling. The
    // pane being moved is never a choice: it cannot trade places with itself.
    const choices = paneRects().filter((rect) => rect.id !== sourceId);
    const next = paneInDirection(choices, targetId, direction);
    if (next) set({ targetId: next });
  },
  confirm() {
    const { sourceId, targetId } = get();
    set({ sourceId: null, targetId: null });
    if (sourceId && targetId && sourceId !== targetId)
      useWorkspaceStore.getState().swapPanes(sourceId, targetId);
  },
  cancel() {
    set({ sourceId: null, targetId: null });
  },
}));
