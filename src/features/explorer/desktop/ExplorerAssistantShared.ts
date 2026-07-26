import { selectedPathsForPane, useExplorerStore } from "@/stores/explorer";
import type { AiStatus } from "@/models/interfaces/stores/assistant/useAgentSessionStore";

export function assistantStatusText(status: AiStatus | null): string {
  if (!status) return "Checking Agents...";
  if (status.configured) return `Ready (${status.modelName})`;
  return "Backend unavailable";
}

export function assistantPlaceholder(configured: boolean, fallback: string): string {
  return configured ? fallback : "Configure hosted Agents to continue";
}

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
