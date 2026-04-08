import { selectedPathsForPane, useExplorerStore } from "@/stores/explorer";
import type { AiStatus } from "@/models/interfaces/stores/assistant/useMikaSessionStore";

export function assistantStatusText(status: AiStatus | null): string {
  if (!status) return "Checking Mika...";
  if (status.configured) return `Ready (${status.modelName})`;
  return "Backend unavailable";
}

export function assistantPlaceholder(configured: boolean, fallback: string): string {
  return configured ? fallback : "Configure Mika backend to continue";
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

export function mikaSelectionSummary(selectedPaths: string[]): string {
  if (selectedPaths.length === 0) return "None";
  if (selectedPaths.length === 1) return titleFromPath(selectedPaths[0]);
  return `${selectedPaths.length} items selected`;
}

export function buildMikaPrompt(
  userPrompt: string,
  workingDirectory: string,
  selectedPaths: string[],
): string {
  const selectedContext =
    selectedPaths.length > 0
      ? [`Selected items (${selectedPaths.length}):`, ...selectedPaths.map((path) => `- ${path}`)]
      : ["Selected items: none"];
  const context = [
    "You are helping inside Misty, a desktop file manager.",
    "Mika is beta and experimental.",
    "Your main goal is to help reorganize files. You may chat freely, but tool-assisted work should stay focused on listing, searching, validating, and proposing safe file organization plans.",
    "Do not inspect file contents or ask for preview tools. For changes, propose a file plan with folders, moves, and renames for the user to review.",
    workingDirectory ? `Current folder: ${workingDirectory}` : "Current folder: none",
    ...selectedContext,
  ].join("\n");
  return `${context}\n\nUser request:\n${userPrompt}`;
}

export function randomMikaPeek(): { leftPercent: number; tiltDegrees: number; popped: boolean } {
  return {
    leftPercent: randomInteger(10, 90),
    tiltDegrees: randomInteger(-8, 8),
    popped: true,
  };
}

export function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function titleFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path || "Home";
}
