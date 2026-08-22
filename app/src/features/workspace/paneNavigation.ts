export type PaneDirection = "left" | "right" | "up" | "down";

export interface PaneBounds {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function paneIdInDirection(
  currentPaneId: string,
  direction: PaneDirection,
  panes: PaneBounds[],
): string | null {
  const current = panes.find((pane) => pane.id === currentPaneId);
  if (!current) return null;
  const origin = center(current);
  const candidates = panes
    .filter((pane) => pane.id !== currentPaneId)
    .map((pane) => {
      const target = center(pane);
      const horizontal = target.x - origin.x;
      const vertical = target.y - origin.y;
      const primary =
        direction === "left"
          ? -horizontal
          : direction === "right"
            ? horizontal
            : direction === "up"
              ? -vertical
              : vertical;
      const cross = direction === "left" || direction === "right" ? vertical : horizontal;
      return { id: pane.id, primary, score: primary + Math.abs(cross) * 2 };
    })
    .filter((candidate) => candidate.primary > 0)
    .sort((a, b) => a.score - b.score || a.primary - b.primary);
  return candidates[0]?.id ?? null;
}

export function paneBoundsFromDocument(): PaneBounds[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-workspace-pane]")).map(
    (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        id: element.dataset.workspacePane ?? "",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      };
    },
  );
}

function center(bounds: PaneBounds) {
  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
  };
}
