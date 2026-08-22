export type {
  ContextMenuBranchItem,
  ContextMenuEntry,
  ContextMenuLeafItem,
} from "../model/types/workspace/ExplorerContextMenu";
export {
  canActOnLocalArchiveFile,
  extractArchiveHere,
  extractArchiveTo,
} from "./contextMenu/fileActions";
export { compareSeedForPane, openCompareWith } from "./contextMenu/remoteVerification";
import { selectShortcutPreferences, useSettingsStore } from "@/features/settings";
import { effectiveShortcut, formatShortcutLabel } from "@/features/shortcuts";
import { AddFilesToSpaceDialog } from "@/features/spaces/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui";
import {
  AppWindow,
  Archive,
  ArrowRightLeft,
  Clipboard,
  Copy,
  Download,
  Eye,
  FilePlus,
  Folder,
  FolderPlus,
  Hash,
  Link,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  Pin,
  RefreshCcw,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { memo, useState } from "react";
import type {
  ContextMenuEntry,
  ContextMenuLeafItem,
} from "../model/types/workspace/ExplorerContextMenu";
import { useExplorerStore } from "../store";
import { buildArchiveItems, buildFileToolsItems } from "./contextMenu/archiveToolsItems";
import {
  isContextMenuBranch,
  openCompareWith,
  verifyExplorerRemotePath,
} from "./contextMenu/remoteVerification";
import { calculateSelectedFolderSizes } from "./contextMenu/selectionHelpers";
import { useContextMenuState } from "./contextMenu/useContextMenuState";
import { clearSelectionsAcrossPanes } from "./ExplorerAgentPanels";

export const ExplorerContextMenu = memo(function ExplorerContextMenu() {
  const [addToSpacePaths, setAddToSpacePaths] = useState<string[]>([]);
  const shortcutHintsEnabled = useSettingsStore(
    (state) => selectShortcutPreferences(state.settings?.document).shortcutHintsEnabled,
  );
  const shortcutPlatform = useSettingsStore(
    (state) => state.shortcuts?.detectedPlatform ?? "linux",
  );
  useSettingsStore((state) => state.shortcuts);
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

  const selectionDisabledReason = hasSelection ? undefined : "Select a file or folder first.";
  const canAddCopiesToSpace =
    selectedLocalFilePaths.length > 0 && selectedLocalFilePaths.length === selectedCount;
  const createDisabledReason = "New items are only available in writable folders.";
  const shortcutFor = (commandId: string) =>
    shortcutHintsEnabled
      ? formatShortcutLabel(effectiveShortcut(commandId).primary, shortcutPlatform) || undefined
      : undefined;

  const run = (action: () => void) => {
    useExplorerStore.getState().closeContextMenu();
    action();
  };

  const newItems: ContextMenuLeafItem[] = [
    {
      id: "new-folder",
      icon: <FolderPlus size={17} />,
      label: "New Folder",
      shortcut: shortcutFor("explorer.new_folder"),
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
      shortcut: shortcutFor("explorer.copy"),
      disabled: !hasSelection,
      disabledReason: selectionDisabledReason,
      onRun: () => run(() => useExplorerStore.getState().copySelected(paneId)),
    },
    {
      id: "cut",
      icon: <Scissors size={17} />,
      label: "Cut",
      shortcut: shortcutFor("explorer.cut"),
      disabled: !hasSelection,
      disabledReason: selectionDisabledReason,
      onRun: () => run(() => useExplorerStore.getState().cutSelected(paneId)),
    },
    {
      id: "paste",
      icon: <Clipboard size={17} />,
      label: "Paste",
      shortcut: shortcutFor("explorer.paste"),
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
            shortcut: shortcutFor("explorer.delete"),
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
    targetEntry,
    run,
    shortcutFor,
  };
  const archiveItems = buildArchiveItems(archiveToolsContext);
  const fileToolsItems = buildFileToolsItems(archiveToolsContext);
  const renameItems: ContextMenuLeafItem[] = [
    {
      id: "rename-inline",
      icon: <Pencil size={17} />,
      label: "Rename",
      shortcut: shortcutFor("explorer.rename"),
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
          shortcut: shortcutFor("explorer.toggle_hidden"),
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
      shortcut: shortcutFor("explorer.refresh"),
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
      <span className="inline-flex w-[19px] items-center justify-center text-cream-muted">
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
            className="max-h-[min(560px,calc(100dvh-2rem))] w-[250px] overflow-y-auto"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {menuEntries.map((item) =>
              isContextMenuBranch(item) ? (
                <DropdownMenuSub key={item.id}>
                  <DropdownMenuSubTrigger
                    disabled={item.disabled}
                    title={item.disabled ? item.disabledReason : undefined}
                  >
                    <span className="inline-flex w-[19px] items-center justify-center text-cream-muted">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                      {item.label}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-[min(560px,calc(100dvh-2rem))] w-[246px] overflow-y-auto">
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
