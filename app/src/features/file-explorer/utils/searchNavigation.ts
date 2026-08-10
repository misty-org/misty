import { useMediaViewerStore } from "@/features/file-preview";
import type { SearchResult } from "@/services/misty/model/misty-api";
import type { ExplorerSearchNavigationTarget } from "../model/interfaces/utils/searchNavigation";
import { useExplorerStore } from "../store";
export type { ExplorerSearchNavigationTarget } from "../model/interfaces/utils/searchNavigation";

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
  if (
    target.result.entry.location.providerType === "misty-space" &&
    target.result.entry.location.remotePath
  ) {
    window.history.pushState({}, "", target.result.entry.location.remotePath);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
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
