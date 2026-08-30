import { useExplorerStore } from "../../store";

export function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

export function fileStem(path: string) {
  const parts = path.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "Archive";
  return (
    name.replace(/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z|rar)$/i, "").replace(/\.[^.]+$/, "") ||
    "Archive"
  );
}

export function primaryShortcutLabel(): string {
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform))
    return "Cmd";
  return "Ctrl";
}

export function selectedActionableEntryCount(
  pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined,
): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id) && !entry.isDeleted).length;
}

export function selectedFolderEntryCount(
  pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined,
): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter(
    (entry) => selected.has(entry.id) && !entry.isDeleted && entry.kind === "folder",
  ).length;
}

export function selectedRemoteEntryCount(
  pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined,
): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter(
    (entry) => selected.has(entry.id) && !entry.isDeleted && entry.location.kind === "remote",
  ).length;
}

export function localFilePathsForPane(
  pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined,
): string[] {
  if (!pane?.listing) return [];
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries
    .filter(
      (entry) =>
        selected.has(entry.id) &&
        !entry.isDeleted &&
        entry.kind === "file" &&
        entry.location.kind === "local",
    )
    .map((entry) => entry.path);
}

export function calculateSelectedFolderSizes(paneId: string): void {
  const pane = useExplorerStore.getState().panes[paneId];
  if (!pane?.listing) return;
  const selected = new Set(pane.selectedIds);
  const paths = pane.listing.entries
    .filter((entry) => selected.has(entry.id) && !entry.isDeleted && entry.kind === "folder")
    .map((entry) => entry.path);
  void useExplorerStore.getState().calculateDirectorySizes(paths, { force: true, notify: true });
}
