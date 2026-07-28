import { selectedDeletePathsForPane, useExplorerStore } from "@/stores/explorer";
import { useShallow } from "zustand/react/shallow";
import { selectedCountAcrossPanes } from "../ExplorerAgentPanels";
import {
  localFilePathsForPane,
  selectedActionableEntryCount,
  selectedFolderEntryCount,
  selectedRemoteEntryCount,
} from "./selectionHelpers";
import { normalizedPath } from "./remoteVerification";

const emptyPinnedPaths: string[] = [];
const emptyStringArray: string[] = [];

/** The Explorer store slice the context menu reads, in one memoized selector. */
export function useContextMenuState() {
  const {
    open,
    x,
    y,
    paneId,
    entryId,
    hasClipboard,
    showHidden,
    targetEntry,
    hasSelection,
    selectedAcrossPanesCount,
    hasRemoteSelection,
    canCalculateDirectorySizes,
    targetPinned,
    targetCanOpenWith,
    targetRemoteName,
    targetRemotePath,
    inTrash,
    canTrashSelection,
    hasPermanentDeleteSelection,
    canCreateFile,
    canCreateFolder,
    selectedCount,
  } = useExplorerStore(
    useShallow((state) => {
      const { open, x, y, paneId, entryId } = state.contextMenu;
      const targetPane = open ? state.panes[paneId] : undefined;
      const targetEntry =
        open && entryId
          ? (targetPane?.listing?.entries.find((entry) => entry.id === entryId) ?? null)
          : null;
      const selectedCount = open ? selectedActionableEntryCount(targetPane) : 0;
      const selectedFolderCount = open ? selectedFolderEntryCount(targetPane) : 0;
      const remoteSelectedCount = open ? selectedRemoteEntryCount(targetPane) : 0;
      const trashableCount = open ? selectedDeletePathsForPane(targetPane, false).length : 0;
      const permanentDeleteCount = open ? selectedDeletePathsForPane(targetPane, true).length : 0;
      const pinnedPaths = open && entryId ? state.pinnedPaths : emptyPinnedPaths;
      return {
        open,
        x,
        y,
        paneId,
        entryId,
        hasClipboard: Boolean(state.clipboard?.items.length),
        showHidden: state.paneShowHidden[paneId] ?? state.showHidden,
        targetEntry,
        hasSelection: Boolean(entryId && selectedCount),
        selectedAcrossPanesCount: open ? selectedCountAcrossPanes(state.panes) : 0,
        hasRemoteSelection: Boolean(remoteSelectedCount),
        canCalculateDirectorySizes: selectedFolderCount > 0,
        targetPinned: Boolean(
          targetEntry &&
          !targetEntry.isDeleted &&
          pinnedPaths.some((path) => normalizedPath(path) === normalizedPath(targetEntry.path)),
        ),
        targetCanOpenWith: Boolean(
          targetEntry &&
          !targetEntry.isDeleted &&
          targetEntry.kind !== "folder" &&
          targetEntry.kind !== "symlink",
        ),
        targetRemoteName:
          targetEntry?.location.kind === "remote" ? targetEntry.location.remoteName : null,
        targetRemotePath:
          targetEntry?.location.kind === "remote" ? targetEntry.location.remotePath : null,
        inTrash: targetPane?.listing?.path === "misty://trash",
        canTrashSelection: trashableCount > 0 && trashableCount === selectedCount,
        hasPermanentDeleteSelection: permanentDeleteCount > 0,
        canCreateFile: state.canCreateItem(paneId, "file"),
        canCreateFolder: state.canCreateItem(paneId, "folder"),
        selectedCount,
      };
    }),
  );
  // Kept as its own useShallow selector so the array is compared element-wise;
  // returning it inside the object above breaks shallow equality (a fresh array
  // ref every render) and drives an infinite useSyncExternalStore render loop.
  const selectedLocalFilePaths = useExplorerStore(
    useShallow((state) => {
      const { open, paneId } = state.contextMenu;
      const targetPane = open ? state.panes[paneId] : undefined;
      return open ? localFilePathsForPane(targetPane) : emptyStringArray;
    }),
  );

  return {
    open,
    x,
    y,
    paneId,
    entryId,
    hasClipboard,
    showHidden,
    targetEntry,
    hasSelection,
    selectedAcrossPanesCount,
    hasRemoteSelection,
    canCalculateDirectorySizes,
    targetPinned,
    targetCanOpenWith,
    targetRemoteName,
    targetRemotePath,
    inTrash,
    canTrashSelection,
    hasPermanentDeleteSelection,
    canCreateFile,
    canCreateFolder,
    selectedCount,
    selectedLocalFilePaths,
  };
}
