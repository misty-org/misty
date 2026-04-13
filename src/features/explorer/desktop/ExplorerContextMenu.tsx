import type {
  ContextMenuLeafItem,
  ContextMenuBranchItem,
  ContextMenuEntry,
} from "@/models/types/features/explorer/desktop/ExplorerContextMenu";
export type {
  ContextMenuLeafItem,
  ContextMenuBranchItem,
  ContextMenuEntry,
} from "@/models/types/features/explorer/desktop/ExplorerContextMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui";
import {
  AppWindow,
  Archive,
  ArrowRightLeft,
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FilePlus,
  Folder,
  FolderPlus,
  Hash,
  Link,
  MoreHorizontal,
  Pencil,
  PanelsTopLeft,
  Pin,
  RefreshCcw,
  Scissors,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { memo, useState } from "react";
import type { ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  archiveCreate,
  archiveExtract,
  archiveList,
  fileToolsChecksum,
  fileToolsCreateSymlink,
  fileToolsReadSymlink,
  openTerminalAtPath,
  providersJobStatus,
  providersVerifyResult,
  providersVerifyStart,
} from "@/stores/backend";
import {
  selectedDeletePathsForPane,
  selectedPathsForPane,
  useExplorerStore,
} from "@/stores/explorer";
import { selectShortcutPreferences, useSettingsStore } from "@/stores/app";
import { errorText } from "@/lib/format";
import { useShallow } from "zustand/react/shallow";
import { clearSelectionsAcrossPanes, selectedCountAcrossPanes } from "./ExplorerAgentPanels";
import type { CompareDialogSeed } from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import { AddFilesToSpaceDialog } from "@/features/spaces/components/AddFilesToSpaceDialog";

const explorerCompareWithEvent = "misty:explorer-compare-with";
const emptyPinnedPaths: string[] = [];
const emptyStringArray: string[] = [];

function isContextMenuBranch(item: ContextMenuEntry): item is ContextMenuBranchItem {
  return "items" in item;
}

async function verifyExplorerRemotePath(remote: string, remotePath: string): Promise<void> {
  const explorer = useExplorerStore.getState();
  const target = window.prompt("Compare against local path or remote path in this provider:", "");
  if (!target) return;
  try {
    const local = target.startsWith("/");
    const started = await providersVerifyStart({
      source: { kind: "remote", remote, path: remotePath },
      dest: { kind: local ? "local" : "remote", remote: local ? undefined : remote, path: target },
      options: { profile: { transfers: 4, checkers: 8, retries: 3, lowLevelRetries: 10 } },
    });
    explorer.pushNotification("Verify started.", "info", 3000);
    const result = await waitForVerifyResult(started.jobId);
    const issueCount =
      result.missingOnSrc.length +
      result.missingOnDst.length +
      result.differ.length +
      result.error.length;
    explorer.pushNotification(
      result.success && issueCount === 0
        ? "Verify complete. No differences found."
        : `Verify complete. ${issueCount} ${issueCount === 1 ? "issue" : "issues"} found.`,
      result.success && issueCount === 0 ? "success" : "info",
      5500,
    );
  } catch (error) {
    explorer.pushNotification(`Verify failed: ${errorText(error)}`, "error", 5500);
  }
}

async function waitForVerifyResult(
  jobId: string,
): Promise<Awaited<ReturnType<typeof providersVerifyResult>>> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const status = await providersJobStatus(jobId);
    if (status.resultReady) return providersVerifyResult(jobId);
    if (status.state === "failed" || status.state === "cancelled") {
      throw new Error(status.message ?? `Verify ${status.state}.`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw new Error("Verify did not finish before the local timeout.");
}

export function openCompareWith(paneId: string): void {
  window.dispatchEvent(
    new CustomEvent(explorerCompareWithEvent, { detail: compareSeedForPane(paneId) }),
  );
}

export function compareSeedForPane(paneId: string): CompareDialogSeed {
  const pane = useExplorerStore.getState().panes[paneId];
  const selectedIds = new Set(pane?.selectedIds ?? []);
  const selected = pane?.listing?.entries.find(
    (entry) => selectedIds.has(entry.id) && !entry.isDeleted,
  );
  const leftPath = selected?.path ?? pane?.listing?.path ?? "";
  return {
    paneId,
    leftPath,
    mode: selected?.kind === "folder" ? "folder" : "file",
  };
}

function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export const ExplorerContextMenu = memo(function ExplorerContextMenu() {
  const [addToSpacePaths, setAddToSpacePaths] = useState<string[]>([]);
  const shortcutHintsEnabled = useSettingsStore(
    (state) => selectShortcutPreferences(state.settings?.document).shortcutHintsEnabled,
  );
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
  if (!open && addToSpacePaths.length === 0) return null;

  const primaryShortcut = shortcutHintsEnabled ? primaryShortcutLabel() : "";
  const selectionDisabledReason = hasSelection ? undefined : "Select a file or folder first.";
  const canAddCopiesToSpace =
    selectedLocalFilePaths.length > 0 && selectedLocalFilePaths.length === selectedCount;
  const createDisabledReason = "New items are only available in writable folders.";
  const shortcut = (value: string) => (shortcutHintsEnabled ? value : undefined);

  const run = (action: () => void) => {
    useExplorerStore.getState().closeContextMenu();
    action();
  };

  const newItems: ContextMenuLeafItem[] = [
    {
      id: "new-folder",
      icon: <FolderPlus size={17} />,
      label: "New Folder",
      shortcut: shortcut(`${primaryShortcut}+Shift+N`),
      disabled: !canCreateFolder,
      disabledReason: createDisabledReason,
      onRun: () => run(() => void useExplorerStore.getState().createItem(paneId, "folder")),
    },
    {
      id: "new-file",
      icon: <FilePlus size={17} />,
      label: "New File",
      disabled: !canCreateFile,
      disabledReason: createDisabledReason,
      onRun: () => run(() => void useExplorerStore.getState().createItem(paneId, "file")),
    },
  ];

  const clipboardItems: ContextMenuLeafItem[] = [
    {
      id: "copy",
      icon: <Copy size={17} />,
      label: "Copy",
      shortcut: shortcut(`${primaryShortcut}+C`),
      disabled: !hasSelection,
      disabledReason: selectionDisabledReason,
      onRun: () => run(() => useExplorerStore.getState().copySelected(paneId)),
    },
    {
      id: "cut",
      icon: <Scissors size={17} />,
      label: "Cut",
      shortcut: shortcut(`${primaryShortcut}+X`),
      disabled: !hasSelection,
      disabledReason: selectionDisabledReason,
      onRun: () => run(() => useExplorerStore.getState().cutSelected(paneId)),
    },
    {
      id: "paste",
      icon: <Clipboard size={17} />,
      label: "Paste",
      shortcut: shortcut(`${primaryShortcut}+V`),
      disabled: !hasClipboard,
      disabledReason: hasClipboard ? undefined : "Copy or cut something first.",
      onRun: () => run(() => void useExplorerStore.getState().pasteIntoPane(paneId)),
    },
    {
      id: "deselect",
      icon: <X size={17} />,
      label: "Deselect All",
      disabled: selectedAcrossPanesCount === 0,
      disabledReason: "No selected items.",
      onRun: () => run(clearSelectionsAcrossPanes),
    },
  ];

  const deleteItems: ContextMenuLeafItem[] = [
    ...(!inTrash
      ? [
          {
            id: "trash",
            icon: <Trash2 size={17} />,
            label: "Trash",
            shortcut: shortcut("Del"),
            disabled: !canTrashSelection,
            disabledReason: hasSelection
              ? "Trash is only available for local files and folders."
              : selectionDisabledReason,
            onRun: () =>
              run(() => void useExplorerStore.getState().deleteSelected(paneId, "trash")),
          } satisfies ContextMenuLeafItem,
        ]
      : []),
    {
      id: "delete-permanent",
      icon: <X size={17} />,
      label: "Delete Permanently",
      disabled: !hasPermanentDeleteSelection,
      disabledReason: hasPermanentDeleteSelection ? undefined : selectionDisabledReason,
      onRun: () => run(() => void useExplorerStore.getState().deleteSelected(paneId, "permanent")),
    },
  ];

  const remoteItems: ContextMenuLeafItem[] = [
    {
      id: "download",
      icon: <Download size={17} />,
      label: "Download",
      disabled: !hasRemoteSelection,
      disabledReason: "Download is available for remote files and folders.",
      onRun: () => run(() => void useExplorerStore.getState().downloadSelected(paneId)),
    },
    {
      id: "verify",
      icon: <ArrowRightLeft size={17} />,
      label: "Verify against...",
      disabled: !targetRemoteName || !targetRemotePath,
      disabledReason: "Verify is available for provider files and folders.",
      onRun: () =>
        run(
          () =>
            targetRemoteName &&
            targetRemotePath &&
            void verifyExplorerRemotePath(targetRemoteName, targetRemotePath),
        ),
    },
  ];

  const archiveItems: ContextMenuLeafItem[] = [
    {
      id: "archive-preview",
      icon: <Eye size={17} />,
      label: "Preview Archive",
      disabled: !canActOnLocalArchiveFile(targetEntry, hasRemoteSelection),
      disabledReason: hasRemoteSelection
        ? "Archive preview is available for local files."
        : "Choose an archive file.",
      onRun: () => run(() => targetEntry && void previewArchive(targetEntry.path)),
    },
    {
      id: "compress",
      icon: <FileArchive size={17} />,
      label: "Compress to ZIP",
      disabled: !hasSelection || hasRemoteSelection,
      disabledReason: hasRemoteSelection
        ? "Compress is available for local selections."
        : selectionDisabledReason,
      onRun: () => run(() => void compressSelectedItems(paneId)),
    },
    {
      id: "extract-here",
      icon: <Archive size={17} />,
      label: "Extract Here",
      disabled: !canActOnLocalArchiveFile(targetEntry, hasRemoteSelection),
      disabledReason: hasRemoteSelection
        ? "Extract is available for local files."
        : "Choose an archive file.",
      onRun: () => run(() => targetEntry && void extractArchiveHere(targetEntry.path, paneId)),
    },
    {
      id: "extract-to",
      icon: <FolderPlus size={17} />,
      label: "Extract To...",
      disabled: !canActOnLocalArchiveFile(targetEntry, hasRemoteSelection),
      disabledReason: hasRemoteSelection
        ? "Extract is available for local files."
        : "Choose an archive file.",
      onRun: () => run(() => targetEntry && void extractArchiveTo(targetEntry.path, paneId)),
    },
  ];

  const fileToolsItems: ContextMenuLeafItem[] = [
    {
      id: "sha256",
      icon: <Hash size={17} />,
      label: "SHA-256 Checksum",
      disabled: !targetEntry || targetEntry.kind !== "file" || hasRemoteSelection,
      disabledReason: "Choose one local file.",
      onRun: () => run(() => targetEntry && void copySha256Checksum(targetEntry.path)),
    },
    {
      id: "symlink",
      icon: <Link size={17} />,
      label: "Create Symlink...",
      disabled: !targetEntry || hasRemoteSelection,
      disabledReason: "Symlinks are available for local files and folders.",
      onRun: () => run(() => targetEntry && void createSymlinkForEntry(targetEntry.path, paneId)),
    },
    {
      id: "reveal-symlink-target",
      icon: <ExternalLink size={17} />,
      label: "Reveal Symlink Target",
      disabled: !targetEntry || targetEntry.kind !== "symlink" || hasRemoteSelection,
      disabledReason: "Choose one local symlink.",
      onRun: () => run(() => targetEntry && void revealSymlinkTarget(targetEntry.path, paneId)),
    },
    {
      id: "copy-path",
      icon: <Copy size={17} />,
      label: "Copy Path",
      shortcut: shortcut(`${primaryShortcut}+Alt+C`),
      disabled: !targetEntry,
      disabledReason: "Choose an item first.",
      onRun: () =>
        run(() => targetEntry && void useExplorerStore.getState().copyPath(targetEntry.path)),
    },
    {
      id: "terminal-here",
      icon: <Terminal size={17} />,
      label: "Terminal Here",
      disabled: !targetEntry || hasRemoteSelection,
      disabledReason: "Terminal is available for local files and folders.",
      onRun: () =>
        run(
          () =>
            targetEntry &&
            void openTerminalForEntry(targetEntry.path, targetEntry.kind === "folder"),
        ),
    },
  ];

  const renameItems: ContextMenuLeafItem[] = [
    {
      id: "rename-inline",
      icon: <Pencil size={17} />,
      label: "Rename",
      shortcut: shortcut("Enter"),
      disabled: !hasSelection,
      disabledReason: selectionDisabledReason,
      onRun: () => run(() => void useExplorerStore.getState().renameSelected(paneId)),
    },
    {
      id: "batch-rename",
      icon: <Pencil size={17} />,
      label: "Batch Rename...",
      disabled: !hasSelection,
      disabledReason: selectionDisabledReason,
      onRun: () => run(() => useExplorerStore.getState().openBatchRenameDialog(paneId)),
    },
  ];

  const moreItems: ContextMenuLeafItem[] = entryId
    ? [
        {
          id: "pin",
          icon: <Pin size={17} />,
          label: targetPinned ? "Unpin from Quick access" : "Pin to Quick access",
          disabled: !targetEntry || targetEntry.isDeleted || targetEntry.kind !== "folder",
          disabledReason: "Only folders can be pinned.",
          onRun: () =>
            run(
              () => targetEntry && useExplorerStore.getState().togglePinnedPath(targetEntry.path),
            ),
        },
        {
          id: "folder-sizes",
          icon: <Folder size={17} />,
          label: "Calculate Folder Sizes",
          disabled: !canCalculateDirectorySizes,
          disabledReason: "Select one or more folders.",
          onRun: () => run(() => calculateSelectedFolderSizes(paneId)),
        },
      ]
    : [
        {
          id: "hidden-files",
          icon: <Eye size={17} />,
          label: showHidden ? "Hide Hidden Files" : "Show Hidden Files",
          shortcut: shortcut(`${primaryShortcut}+Shift+.`),
          onRun: () => run(() => void useExplorerStore.getState().toggleHidden(paneId)),
        },
      ];

  const menuEntries: ContextMenuEntry[] = [
    { id: "new", icon: <FolderPlus size={17} />, label: "New", items: newItems },
    { id: "clipboard", icon: <Clipboard size={17} />, label: "Clipboard", items: clipboardItems },
    {
      id: "add-to-space",
      icon: <PanelsTopLeft size={17} />,
      label: "Add copy to Space...",
      disabled: !canAddCopiesToSpace,
      disabledReason: hasSelection
        ? "Choose local files only. Folders and cloud items cannot be uploaded directly."
        : "Select one or more local files first.",
      onRun: () => {
        const paths = [...selectedLocalFilePaths];
        useExplorerStore.getState().closeContextMenu();
        setAddToSpacePaths(paths);
      },
    },
    {
      id: "rename",
      icon: <Pencil size={17} />,
      label: "Rename",
      disabled: !hasSelection,
      disabledReason: selectionDisabledReason,
      items: renameItems,
    },
    {
      id: "compare-with",
      icon: <ArrowRightLeft size={17} />,
      label: "Compare With...",
      disabled: !hasSelection || hasRemoteSelection,
      disabledReason: hasRemoteSelection
        ? "Compare is available for local files and folders."
        : selectionDisabledReason,
      onRun: () => run(() => openCompareWith(paneId)),
    },
    { id: "delete", icon: <Trash2 size={17} />, label: "Delete", items: deleteItems },
    { id: "archive", icon: <Archive size={17} />, label: "Archive", items: archiveItems },
    { id: "file-tools", icon: <Hash size={17} />, label: "File Tools", items: fileToolsItems },
    { id: "remote", icon: <Link size={17} />, label: "Remote", items: remoteItems },
    ...(entryId
      ? [
          {
            id: "open-with",
            icon: <AppWindow size={17} />,
            label: "Open With...",
            disabled: !targetCanOpenWith,
            disabledReason: "Open With is available for files.",
            onRun: () => run(() => void useExplorerStore.getState().openWithSelected(paneId)),
          } satisfies ContextMenuLeafItem,
        ]
      : []),
    { id: "more", icon: <MoreHorizontal size={17} />, label: "More", items: moreItems },
    {
      id: "refresh",
      icon: <RefreshCcw size={17} />,
      label: "Refresh",
      shortcut: shortcut(`${primaryShortcut}+R`),
      onRun: () => run(() => void useExplorerStore.getState().refreshPane(paneId)),
    },
  ];

  const renderLeaf = (item: ContextMenuLeafItem) => (
    <DropdownMenuItem
      key={item.id}
      disabled={item.disabled}
      title={item.disabled ? item.disabledReason : undefined}
      onSelect={() => item.onRun()}
    >
      <span className="inline-flex w-[19px] items-center justify-center text-muted-foreground">
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {item.label}
      </span>
      {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  );

  return (
    <>
      {open ? (
        <DropdownMenu
          open
          onOpenChange={(next) => {
            if (!next) useExplorerStore.getState().closeContextMenu();
          }}
        >
          <DropdownMenuTrigger asChild>
            <span aria-hidden="true" className="fixed size-0" style={{ left: x, top: y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={0}
            collisionPadding={8}
            className="max-h-[min(560px,var(--radix-dropdown-menu-content-available-height))] w-[250px] overflow-y-auto"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {menuEntries.map((item) =>
              isContextMenuBranch(item) ? (
                <DropdownMenuSub key={item.id}>
                  <DropdownMenuSubTrigger
                    disabled={item.disabled}
                    title={item.disabled ? item.disabledReason : undefined}
                  >
                    <span className="inline-flex w-[19px] items-center justify-center text-muted-foreground">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.label}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[min(560px,var(--radix-dropdown-menu-content-available-height))] w-[246px] overflow-y-auto">
                    {item.items.map(renderLeaf)}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                renderLeaf(item)
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <AddFilesToSpaceDialog
        open={addToSpacePaths.length > 0}
        paths={addToSpacePaths}
        onOpenChange={(next) => {
          if (!next) setAddToSpacePaths([]);
        }}
      />
    </>
  );
});

function isArchivePath(path: string) {
  return /\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z|rar)$/i.test(path);
}

// power_pack.rs's archive tools never reject a misty:// path, so a remote file
// must be gated here or it hits a raw filesystem error instead of a clear message.
export function canActOnLocalArchiveFile(
  targetEntry: FileEntry | null,
  hasRemoteSelection: boolean,
): boolean {
  return Boolean(
    targetEntry &&
    targetEntry.kind === "file" &&
    isArchivePath(targetEntry.path) &&
    !hasRemoteSelection,
  );
}

async function previewArchive(path: string) {
  const explorer = useExplorerStore.getState();
  try {
    const result = await archiveList({ path });
    explorer.pushNotification(
      result.message || `Archive has ${result.entries.length} entries.`,
      "info",
      4500,
    );
  } catch (error) {
    explorer.pushNotification(`Archive preview failed: ${errorText(error)}`, "error", 5500);
  }
}

async function compressSelectedItems(paneId: string) {
  const explorer = useExplorerStore.getState();
  const pane = explorer.panes[paneId];
  const paths = selectedPathsForPane(pane).filter((path) => !path.startsWith("misty://"));
  if (paths.length === 0) {
    explorer.pushNotification("Choose one or more local items to compress.", "info", 3500);
    return;
  }
  const parent = parentPath(paths[0]) || pane?.listing?.path || "";
  const baseName = paths.length === 1 ? fileStem(paths[0]) : "Archive";
  const destinationPath = `${parent}/${baseName}-${new Date().toISOString().slice(0, 10)}.zip`;
  try {
    const result = await archiveCreate({ paths, destinationPath });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Compress failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function extractArchiveHere(path: string, paneId: string) {
  const explorer = useExplorerStore.getState();
  const destinationDir = `${parentPath(path)}/${fileStem(path)}`;
  try {
    const result = await archiveExtract({ archivePath: path, destinationDir });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Extract failed: ${errorText(error)}`, "error", 5500);
  }
}

export async function extractArchiveTo(path: string, paneId: string) {
  const explorer = useExplorerStore.getState();
  const defaultDestination = `${parentPath(path)}/${fileStem(path)}`;
  const destinationDir = window.prompt("Extract archive to folder:", defaultDestination);
  if (!destinationDir?.trim()) return;
  try {
    const result = await archiveExtract({
      archivePath: path,
      destinationDir: destinationDir.trim(),
    });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Extract failed: ${errorText(error)}`, "error", 5500);
  }
}

async function copySha256Checksum(path: string) {
  const explorer = useExplorerStore.getState();
  try {
    const result = await fileToolsChecksum({ path });
    await writeText(result.sha256);
    explorer.pushNotification("SHA-256 copied.", "success", 3500);
  } catch (error) {
    explorer.pushNotification(`Checksum failed: ${errorText(error)}`, "error", 5500);
  }
}

async function createSymlinkForEntry(targetPath: string, paneId: string) {
  const defaultLink = `${targetPath}.link`;
  const linkPath = window.prompt("Create symlink at:", defaultLink);
  if (!linkPath?.trim()) return;
  const explorer = useExplorerStore.getState();
  try {
    const result = await fileToolsCreateSymlink({ targetPath, linkPath: linkPath.trim() });
    explorer.pushNotification(result.message, "success", 4500);
    void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Symlink failed: ${errorText(error)}`, "error", 5500);
  }
}

async function revealSymlinkTarget(path: string, paneId: string) {
  const explorer = useExplorerStore.getState();
  try {
    const result = await fileToolsReadSymlink({ path });
    const targetPath = result.resolvedTargetPath || result.targetPath;
    await writeText(targetPath);
    if (result.targetExists) {
      const revealPath = result.targetIsDir ? targetPath : parentPath(targetPath);
      if (revealPath) void explorer.navigatePane(paneId, revealPath);
      explorer.pushNotification("Symlink target copied and revealed.", "success", 4500);
    } else {
      explorer.pushNotification(
        "Symlink target copied, but the target does not exist.",
        "info",
        5000,
      );
    }
  } catch (error) {
    explorer.pushNotification(`Reveal symlink target failed: ${errorText(error)}`, "error", 5500);
  }
}

async function openTerminalForEntry(path: string, isDirectory: boolean) {
  const target = isDirectory ? path : parentPath(path);
  if (!target) {
    useExplorerStore.getState().pushNotification("No containing folder was found.", "error", 3500);
    return;
  }
  try {
    await openTerminalAtPath(target);
  } catch (error) {
    useExplorerStore
      .getState()
      .pushNotification(`Terminal unavailable: ${errorText(error)}`, "error", 4500);
  }
}

function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

function fileStem(path: string) {
  const parts = path.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "Archive";
  return (
    name.replace(/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z|rar)$/i, "").replace(/\.[^.]+$/, "") ||
    "Archive"
  );
}

function primaryShortcutLabel(): string {
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform))
    return "Cmd";
  return "Ctrl";
}

function selectedActionableEntryCount(
  pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined,
): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id) && !entry.isDeleted).length;
}

function selectedFolderEntryCount(
  pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined,
): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter(
    (entry) => selected.has(entry.id) && !entry.isDeleted && entry.kind === "folder",
  ).length;
}

function selectedRemoteEntryCount(
  pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined,
): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter(
    (entry) => selected.has(entry.id) && !entry.isDeleted && entry.location.kind === "remote",
  ).length;
}

function localFilePathsForPane(
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

function calculateSelectedFolderSizes(paneId: string): void {
  const pane = useExplorerStore.getState().panes[paneId];
  if (!pane?.listing) return;
  const selected = new Set(pane.selectedIds);
  const paths = pane.listing.entries
    .filter((entry) => selected.has(entry.id) && !entry.isDeleted && entry.kind === "folder")
    .map((entry) => entry.path);
  void useExplorerStore.getState().calculateDirectorySizes(paths, { force: true, notify: true });
}
