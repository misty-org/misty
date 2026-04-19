export { compareSeedForPane, openCompareWith } from "./contextMenu/remoteVerification";
import { useContextMenuState } from "./contextMenu/useContextMenuState";
import { buildArchiveItems, buildFileToolsItems } from "./contextMenu/archiveToolsItems";
export {
  canActOnLocalArchiveFile,
  extractArchiveHere,
  extractArchiveTo,
} from "./contextMenu/fileActions";
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
import {
  calculateSelectedFolderSizes,
  localFilePathsForPane,
  primaryShortcutLabel,
  selectedActionableEntryCount,
  selectedFolderEntryCount,
  selectedRemoteEntryCount,
} from "./contextMenu/selectionHelpers";
import {
  canActOnLocalArchiveFile,
  compressSelectedItems,
  copySha256Checksum,
  createSymlinkForEntry,
  extractArchiveHere,
  extractArchiveTo,
  openTerminalForEntry,
  previewArchive,
  revealSymlinkTarget,
} from "./contextMenu/fileActions";
import {
  isContextMenuBranch,
  normalizedPath,
  openCompareWith,
  verifyExplorerRemotePath,
} from "./contextMenu/remoteVerification";

const explorerCompareWithEvent = "misty:explorer-compare-with";
const emptyPinnedPaths: string[] = [];
const emptyStringArray: string[] = [];

export const ExplorerContextMenu = memo(function ExplorerContextMenu() {
  const [addToSpacePaths, setAddToSpacePaths] = useState<string[]>([]);
  const shortcutHintsEnabled = useSettingsStore(
    (state) => selectShortcutPreferences(state.settings?.document).shortcutHintsEnabled,
  );
  const {
    canCalculateDirectorySizes,
    canCreateFile,
    canCreateFolder,
    canTrashSelection,
    entryId,
    hasClipboard,
    hasPermanentDeleteSelection,
    hasRemoteSelection,
    hasSelection,
    inTrash,
    open,
    paneId,
    selectedAcrossPanesCount,
    selectedCount,
    selectedLocalFilePaths,
    showHidden,
    targetCanOpenWith,
    targetEntry,
    targetPinned,
    targetRemoteName,
    targetRemotePath,
    x,
    y,
  } = useContextMenuState();
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

  const archiveToolsContext = {
    hasRemoteSelection,
    hasSelection,
    paneId,
    primaryShortcut,
    targetEntry,
    run,
    shortcut,
  };
  const archiveItems = buildArchiveItems(archiveToolsContext);
  const fileToolsItems = buildFileToolsItems(archiveToolsContext);
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
