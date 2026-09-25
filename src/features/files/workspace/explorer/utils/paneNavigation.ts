import type { DirectoryListing } from "@/native/contracts";
import type { PaneExplorerState } from "../model/interfaces/store/types";
import type { NavigationMode } from "../model/types/store/types";
import { explorerPathKey } from "@/shared/lib/pathNormalization";
const samePath = (left: string, right: string) => explorerPathKey(left) === explorerPathKey(right);
export function applyNavigationResult(
  pane: PaneExplorerState,
  listing: DirectoryListing,
  mode: NavigationMode,
): PaneExplorerState {
  const previousPath = pane.listing?.path ?? "";
  const selectedIdsByPath = previousPath
    ? { ...pane.selectedIdsByPath, [previousPath]: pane.selectedIds }
    : { ...pane.selectedIdsByPath };
  let backHistory = [...pane.backHistory];
  let forwardHistory = [...pane.forwardHistory];

  if (mode === "push" && previousPath && !samePath(previousPath, listing.path)) {
    if (!samePath(backHistory[backHistory.length - 1] ?? "", previousPath))
      backHistory.push(previousPath);
    forwardHistory = [];
  } else if (mode === "back" && previousPath) {
    backHistory = backHistory.slice(0, -1);
    if (!samePath(forwardHistory[forwardHistory.length - 1] ?? "", previousPath))
      forwardHistory.push(previousPath);
  } else if (mode === "forward" && previousPath) {
    forwardHistory = forwardHistory.slice(0, -1);
    if (!samePath(backHistory[backHistory.length - 1] ?? "", previousPath))
      backHistory.push(previousPath);
  }

  const visibleIds = new Set(listing.entries.map((entry) => entry.id));
  const selectedIds = (selectedIdsByPath[listing.path] ?? []).filter((id) => visibleIds.has(id));
  return {
    ...pane,
    listing,
    hasFolderEntries: listing.entries.some((entry) => !entry.isDeleted && entry.kind === "folder"),
    selectedIds,
    selectedIdsByPath,
    backHistory,
    forwardHistory,
    loading: false,
    showLoadingSkeleton: false,
    error: null,
  };
}
