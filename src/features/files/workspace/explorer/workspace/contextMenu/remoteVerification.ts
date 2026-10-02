import type { CompareDialogSeed } from "../../model/interfaces/workspace/ExplorerCompareDialog";
import { useExplorerStore } from "../../store";
import { explorerCompareWithEvent } from "../ExplorerWorkspaceConstants";

export function openCompareWith(paneId: string): void {
  window.dispatchEvent(
    new CustomEvent(explorerCompareWithEvent, { detail: compareSeedForPane(paneId) }),
  );
}

export function compareSeedForPane(paneId: string): CompareDialogSeed {
  const pane = useExplorerStore.getState().panes[paneId];
  const selectedIds = new Set(pane?.selectedIds ?? []);
  const selected = pane?.listing?.entries.find(
    (entry) => selectedIds.has(entry.id) && !entry.isDeleted,
  );
  const leftPath = selected?.path ?? pane?.listing?.path ?? "";
  return {
    paneId,
    leftPath,
    mode: selected?.kind === "folder" ? "folder" : "file",
  };
}

export function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}
