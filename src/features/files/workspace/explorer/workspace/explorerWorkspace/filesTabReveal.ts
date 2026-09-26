import { useWorkspaceStore } from "@/features/workspace";
import type { SearchResult } from "@/native/contracts";
import { searchResultNavigationTarget } from "../../utils/searchNavigation";

// One-shot reveal requests keyed by dock tab id. They live outside the tab's
// persisted state so a restored session never replays an old reveal.
const pendingReveals = new Map<string, SearchResult>();

export function takeFilesTabReveal(tabId: string): SearchResult | undefined {
  const result = pendingReveals.get(tabId);
  pendingReveals.delete(tabId);
  return result;
}

/** Opens a new Files tab at the result's folder, then selects the entry (and
 * opens the media viewer for transcript hits) once the tab's pane is ready. */
export function openFilesTabRevealing(result: SearchResult): string {
  const path = searchResultNavigationTarget(result).path;
  const workspace = useWorkspaceStore.getState();
  const tab = workspace.openSurface({
    surfaceId: "files",
    groupKey: "tool:files",
    title: path.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "Files",
    route: "/files",
    instancePolicy: "multiple",
    forceNew: true,
    state: { version: 1, path },
  });
  pendingReveals.set(tab.id, result);
  workspace.focusTab(tab.id);
  return tab.route;
}
