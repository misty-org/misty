import type { SearchResult } from "@/services/misty-api/types";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useMediaViewerStore } from "../../../stores/useMediaViewerStore";

export interface ExplorerSearchNavigationTarget {
  result: SearchResult;
  path: string;
  selectEntryId: string | null;
}

export function searchResultNavigationTarget(result: SearchResult): ExplorerSearchNavigationTarget {
  const entry = result.entry;
  return {
    result,
    path: entry.kind === "folder" ? entry.path : parentPath(entry.path),
    selectEntryId: entry.kind === "folder" ? null : entry.id,
  };
}

export async function revealSearchResultInPane(
  paneId: string,
  target: ExplorerSearchNavigationTarget,
): Promise<void> {
  await useExplorerStore.getState().navigatePane(paneId, target.path);
  if (target.result.match?.mediaSegmentId) useMediaViewerStore.getState().open(target.result);
  const pane = useExplorerStore.getState().panes[paneId];
  if (pane?.error) {
    const message = searchResultStaleMessage(target.result);
    useExplorerStore.setState((state) => ({
      operationError: message,
      panes: {
        ...state.panes,
        [paneId]: { ...(state.panes[paneId] ?? pane), error: message },
      },
    }));
    return;
  }
  if (!target.selectEntryId) return;
  const resolvedEntry = pane?.listing?.entries.find(
    (entry) =>
      entry.id === target.selectEntryId ||
      normalizePath(entry.path) === normalizePath(target.result.entry.path),
  );
  if (resolvedEntry) {
    useExplorerStore.getState().selectEntry(paneId, resolvedEntry.id);
    return;
  }
  useExplorerStore.setState({ operationError: searchResultStaleMessage(target.result) });
}

export function searchResultStaleMessage(result: SearchResult): string {
  const source =
    result.entry.location.kind === "remote"
      ? (result.entry.location.remoteName ?? "remote")
      : "local disk";
  return `Could not open indexed result from ${source}. It may have moved or changed; reindex search and try again.`;
}

function parentPath(path: string): string {
  const normalized = path.replace(/\/+/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}

function normalizePath(path: string): string {
  return (
    path
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/")
      .replace(/\/$/, "") || "/"
  );
}
