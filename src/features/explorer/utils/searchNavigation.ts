import type { SearchResult } from "../../../api/types";
import { useExplorerStore } from "../state/useExplorerStore";

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
  const entryExists = pane?.listing?.entries.some((entry) => entry.id === target.selectEntryId);
  if (entryExists) {
    useExplorerStore.getState().selectEntry(paneId, target.selectEntryId);
    return;
  }
  useExplorerStore.setState({ operationError: searchResultStaleMessage(target.result) });
}

export function searchResultStaleMessage(result: SearchResult): string {
  const source = result.entry.location.kind === "remote"
    ? result.entry.location.remoteName ?? "remote"
    : "local disk";
  return `Could not open indexed result from ${source}. It may have moved or changed; reindex search and try again.`;
}

function parentPath(path: string): string {
  const normalized = path.replace(/\/+/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "/";
  return normalized.slice(0, index);
}
