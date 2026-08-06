import { selectedPathsForPane, useExplorerStore } from "@/stores/explorer";

export function selectedPathsAcrossPanes(
  panes: ReturnType<typeof useExplorerStore.getState>["panes"],
): string[] {
  const selected = new Set<string>();
  for (const pane of Object.values(panes)) {
    for (const path of selectedPathsForPane(pane)) {
      if (path) selected.add(path);
    }
  }
  return [...selected];
}

export function selectedCountAcrossPanes(
  panes: ReturnType<typeof useExplorerStore.getState>["panes"],
): number {
  return selectedPathsAcrossPanes(panes).length;
}

export function clearSelectionsAcrossPanes(): void {
  const store = useExplorerStore.getState();
  for (const paneId of Object.keys(store.panes)) store.clearSelection(paneId);
}
