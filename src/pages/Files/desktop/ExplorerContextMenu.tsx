import { AppWindow, Archive, ArrowRightLeft, ChevronRight, Clipboard, Copy, Download, ExternalLink, Eye, FileArchive, FilePlus, Folder, FolderPlus, Hash, Link, MoreHorizontal, Pencil, Pin, RefreshCcw, Scissors, Terminal, Trash2, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { archiveCreate, archiveExtract, archiveList, fileToolsChecksum, fileToolsCreateSymlink, fileToolsReadSymlink, openTerminalAtPath, providersCreatePublicLink, providersJobStatus, providersVerifyResult, providersVerifyStart } from "../../../api/misty";
import { selectedDeletePathsForPane, selectedPathsForPane, useExplorerStore } from "../../../stores/useExplorerStore";
import { selectShortcutPreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { errorText } from "../../../shared/format";
import { useShallow } from "zustand/react/shallow";
import { clearSelectionsAcrossPanes, selectedCountAcrossPanes } from "./ExplorerAssistantPanels";
import type { CompareDialogSeed } from "./ExplorerCompareDialog";
import { cx } from "./ExplorerDesktopShared";

const explorerCompareWithEvent = "misty:explorer-compare-with";
const emptyPinnedPaths: string[] = [];

const contextMenuStyles = {
  menu: "fixed z-[1000] w-[250px] overflow-auto rounded-[11px] border border-[#323232] bg-[rgba(17, 17, 17, 0.97)] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl",
  submenu: "fixed z-[1001] w-[246px] overflow-auto rounded-[11px] border border-[#323232] bg-[rgba(17, 17, 17, 0.98)] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.48)] backdrop-blur-xl",
  item:
    "grid h-9 w-full grid-cols-[19px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[#dddddd] hover:not-disabled:bg-[#222222] hover:not-disabled:text-[#eeeeee] disabled:opacity-45 [&:hover:not(:disabled)_.context-menu-icon]:text-[#d0d0d0] [&:hover:not(:disabled)_.context-menu-shortcut]:text-[#d0d0d0]",
  itemActive:
    "bg-[#242424] text-[#eeeeee] [&_.context-menu-icon]:text-[#d0d0d0] [&_.context-menu-shortcut]:text-[#d0d0d0]",
  icon: "context-menu-icon inline-flex items-center justify-center text-[#b6b6b6]",
  label: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  shortcut: "context-menu-shortcut text-xs text-[#898989]",
  separator: "mx-1 my-[5px] h-px bg-[#292929]",
} as const;

const contextMenuViewportMargin = 8;
const contextMenuMaxHeight = 560;
const contextSubmenuWidth = 246;

type ContextMenuLeafItem = {
  id: string;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  onRun: () => void;
};

type ContextMenuBranchItem = {
  id: string;
  icon: ReactNode;
  label: string;
  items: ContextMenuLeafItem[];
};

type ContextMenuEntry = ContextMenuLeafItem | ContextMenuBranchItem;

type ContextSubmenuState = {
  id: string;
  x: number;
  y: number;
  maxHeight: number;
  items: ContextMenuLeafItem[];
} | null;

function isContextMenuBranch(item: ContextMenuEntry): item is ContextMenuBranchItem {
  return "items" in item;
}

function contextSubmenuPosition(anchor: DOMRect, itemCount: number): Pick<NonNullable<ContextSubmenuState>, "x" | "y" | "maxHeight"> {
  const viewport = window.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const minLeft = viewportLeft + contextMenuViewportMargin;
  const minTop = viewportTop + contextMenuViewportMargin;
  const maxHeight = Math.max(120, Math.min(contextMenuMaxHeight, viewportHeight - contextMenuViewportMargin * 2));
  const estimatedHeight = Math.min(maxHeight, 12 + itemCount * 36);
  const viewportRight = viewportLeft + viewportWidth - contextMenuViewportMargin;
  const viewportBottom = viewportTop + viewportHeight - contextMenuViewportMargin;
  const rightLeft = anchor.right + 6;
  const leftLeft = anchor.left - contextSubmenuWidth - 6;
  const x = rightLeft + contextSubmenuWidth <= viewportRight
    ? rightLeft
    : Math.max(minLeft, Math.min(leftLeft, viewportRight - contextSubmenuWidth));
  const y = Math.min(Math.max(anchor.top - 6, minTop), Math.max(minTop, viewportBottom - estimatedHeight));
  return { x, y, maxHeight };
}

function useViewportAnchoredMenu(open: boolean, x: number, y: number) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>(() => ({
    left: x,
    top: y,
    visibility: "hidden",
  }));

  const updatePosition = useCallback(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const rect = menu.getBoundingClientRect();
    const minLeft = viewportLeft + contextMenuViewportMargin;
    const minTop = viewportTop + contextMenuViewportMargin;
    const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - rect.width - contextMenuViewportMargin);
    const maxTop = Math.max(minTop, viewportTop + viewportHeight - rect.height - contextMenuViewportMargin);
    const nextLeft = Math.min(Math.max(x, minLeft), maxLeft);
    const nextTop = Math.min(Math.max(y, minTop), maxTop);
    const maxHeight = Math.max(120, Math.min(contextMenuMaxHeight, viewportHeight - contextMenuViewportMargin * 2));

    setStyle((current) => {
      if (
        current.left === nextLeft &&
        current.top === nextTop &&
        current.maxHeight === maxHeight &&
        current.visibility === "visible"
      ) {
        return current;
      }
      return { left: nextLeft, top: nextTop, maxHeight, visibility: "visible" };
    });
  }, [open, x, y]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ left: x, top: y, visibility: "hidden" });
      return;
    }
    setStyle({ left: x, top: y, visibility: "hidden" });
    updatePosition();
  }, [open, updatePosition, x, y]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(menu);
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open, updatePosition]);

  return { menuRef, style };
}

async function createExplorerPublicLink(remote: string, remotePath: string): Promise<void> {
  const explorer = useExplorerStore.getState();
  try {
    const result = await providersCreatePublicLink({ remote, path: remotePath });
    if (!result.supported) {
      explorer.pushNotification(result.message ?? "Shared links are not supported for this provider.", "info", 4500);
      return;
    }
    const url = result.link?.url;
    if (!url) {
      explorer.pushNotification(result.message ?? "No link was returned.", "info", 4500);
      return;
    }
    await writeText(url);
    explorer.pushNotification("Public link copied.", "success", 3500);
  } catch (error) {
    explorer.pushNotification(`Share link failed: ${errorText(error)}`, "error", 4500);
  }
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
    const issueCount = result.missingOnSrc.length + result.missingOnDst.length + result.differ.length + result.error.length;
    explorer.pushNotification(
      result.success && issueCount === 0 ? "Verify complete. No differences found." : `Verify complete. ${issueCount} ${issueCount === 1 ? "issue" : "issues"} found.`,
      result.success && issueCount === 0 ? "success" : "info",
      5500,
    );
  } catch (error) {
    explorer.pushNotification(`Verify failed: ${errorText(error)}`, "error", 5500);
  }
}

async function waitForVerifyResult(jobId: string): Promise<Awaited<ReturnType<typeof providersVerifyResult>>> {
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
  window.dispatchEvent(new CustomEvent(explorerCompareWithEvent, { detail: compareSeedForPane(paneId) }));
}

export function compareSeedForPane(paneId: string): CompareDialogSeed {
  const pane = useExplorerStore.getState().panes[paneId];
  const selectedIds = new Set(pane?.selectedIds ?? []);
  const selected = pane?.listing?.entries.find((entry) => selectedIds.has(entry.id) && !entry.isDeleted);
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
  const shortcutHintsEnabled = useSettingsStore((state) =>
    selectShortcutPreferences(state.settings?.document).shortcutHintsEnabled,
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
  } = useExplorerStore(useShallow((state) => {
    const { open, x, y, paneId, entryId } = state.contextMenu;
    const targetPane = open ? state.panes[paneId] : undefined;
    const targetEntry = open && entryId
      ? targetPane?.listing?.entries.find((entry) => entry.id === entryId) ?? null
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
      targetPinned: Boolean(targetEntry && !targetEntry.isDeleted && pinnedPaths.some((path) => normalizedPath(path) === normalizedPath(targetEntry.path))),
      targetCanOpenWith: Boolean(targetEntry && !targetEntry.isDeleted && targetEntry.kind !== "folder" && targetEntry.kind !== "symlink"),
      targetRemoteName: targetEntry?.location.kind === "remote" ? targetEntry.location.remoteName : null,
      targetRemotePath: targetEntry?.location.kind === "remote" ? targetEntry.location.remotePath : null,
      inTrash: targetPane?.listing?.path === "misty://trash",
      canTrashSelection: trashableCount > 0 && trashableCount === selectedCount,
      hasPermanentDeleteSelection: permanentDeleteCount > 0,
      canCreateFile: state.canCreateItem(paneId, "file"),
      canCreateFolder: state.canCreateItem(paneId, "folder"),
    };
  }));
  const { menuRef, style: menuStyle } = useViewportAnchoredMenu(open, x, y);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const [submenu, setSubmenu] = useState<ContextSubmenuState>(null);

  useEffect(() => {
    if (!open) setSubmenu(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      if (target && submenuRef.current?.contains(target)) return;
      useExplorerStore.getState().closeContextMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") useExplorerStore.getState().closeContextMenu();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!open) return null;

  const primaryShortcut = shortcutHintsEnabled ? primaryShortcutLabel() : "";
  const selectionDisabledReason = hasSelection ? undefined : "Select a file or folder first.";
  const createDisabledReason = "New items are only available in writable folders.";
  const shortcut = (value: string) => shortcutHintsEnabled ? value : undefined;

  const run = (action: () => void) => {
    useExplorerStore.getState().closeContextMenu();
    action();
  };

  const openSubmenu = (event: PointerEvent<HTMLButtonElement>, item: ContextMenuBranchItem) => {
    const position = contextSubmenuPosition(event.currentTarget.getBoundingClientRect(), item.items.length);
    setSubmenu({ id: item.id, items: item.items, ...position });
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
    ...(!inTrash ? [{
      id: "trash",
      icon: <Trash2 size={17} />,
      label: "Trash",
      shortcut: shortcut("Del"),
      disabled: !canTrashSelection,
      disabledReason: hasSelection ? "Trash is only available for local files and folders." : selectionDisabledReason,
      onRun: () => run(() => void useExplorerStore.getState().deleteSelected(paneId, "trash")),
    } satisfies ContextMenuLeafItem] : []),
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
      id: "share-link",
      icon: <Link size={17} />,
      label: "Share link...",
      disabled: !targetRemoteName || !targetRemotePath,
      disabledReason: "Share links are available for provider files and folders.",
      onRun: () => run(() => targetRemoteName && targetRemotePath && void createExplorerPublicLink(targetRemoteName, targetRemotePath)),
    },
    {
      id: "verify",
      icon: <ArrowRightLeft size={17} />,
      label: "Verify against...",
      disabled: !targetRemoteName || !targetRemotePath,
      disabledReason: "Verify is available for provider files and folders.",
      onRun: () => run(() => targetRemoteName && targetRemotePath && void verifyExplorerRemotePath(targetRemoteName, targetRemotePath)),
    },
  ];

  const archiveItems: ContextMenuLeafItem[] = [
    {
      id: "archive-preview",
      icon: <Eye size={17} />,
      label: "Preview Archive",
      disabled: !targetEntry || targetEntry.kind !== "file" || !isArchivePath(targetEntry.path),
      disabledReason: "Choose an archive file.",
      onRun: () => run(() => targetEntry && void previewArchive(targetEntry.path)),
    },
    {
      id: "compress",
      icon: <FileArchive size={17} />,
      label: "Compress to ZIP",
      disabled: !hasSelection || hasRemoteSelection,
      disabledReason: hasRemoteSelection ? "Compress is available for local selections." : selectionDisabledReason,
      onRun: () => run(() => void compressSelectedItems(paneId)),
    },
    {
      id: "extract-here",
      icon: <Archive size={17} />,
      label: "Extract Here",
      disabled: !targetEntry || targetEntry.kind !== "file" || !isArchivePath(targetEntry.path),
      disabledReason: "Choose an archive file.",
      onRun: () => run(() => targetEntry && void extractArchiveHere(targetEntry.path)),
    },
    {
      id: "extract-to",
      icon: <FolderPlus size={17} />,
      label: "Extract To...",
      disabled: !targetEntry || targetEntry.kind !== "file" || !isArchivePath(targetEntry.path),
      disabledReason: "Choose an archive file.",
      onRun: () => run(() => targetEntry && void extractArchiveTo(targetEntry.path)),
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
      onRun: () => run(() => targetEntry && void useExplorerStore.getState().copyPath(targetEntry.path)),
    },
    {
      id: "terminal-here",
      icon: <Terminal size={17} />,
      label: "Terminal Here",
      disabled: !targetEntry || hasRemoteSelection,
      disabledReason: "Terminal is available for local files and folders.",
      onRun: () => run(() => targetEntry && void openTerminalForEntry(targetEntry.path, targetEntry.kind === "folder")),
    },
  ];

  const moreItems: ContextMenuLeafItem[] = entryId ? [
    {
      id: "pin",
      icon: <Pin size={17} />,
      label: targetPinned ? "Unpin from Quick access" : "Pin to Quick access",
      disabled: !targetEntry || targetEntry.isDeleted || targetEntry.kind !== "folder",
      disabledReason: "Only folders can be pinned.",
      onRun: () => run(() => targetEntry && useExplorerStore.getState().togglePinnedPath(targetEntry.path)),
    },
    {
      id: "folder-sizes",
      icon: <Folder size={17} />,
      label: "Calculate Folder Sizes",
      disabled: !canCalculateDirectorySizes,
      disabledReason: "Select one or more folders.",
      onRun: () => run(() => calculateSelectedFolderSizes(paneId)),
    },
  ] : [
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
      id: "rename",
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
    {
      id: "compare-with",
      icon: <ArrowRightLeft size={17} />,
      label: "Compare With...",
      disabled: !hasSelection || hasRemoteSelection,
      disabledReason: hasRemoteSelection ? "Compare is available for local files and folders." : selectionDisabledReason,
      onRun: () => run(() => openCompareWith(paneId)),
    },
    { id: "delete", icon: <Trash2 size={17} />, label: "Delete", items: deleteItems },
    { id: "archive", icon: <Archive size={17} />, label: "Archive", items: archiveItems },
    { id: "file-tools", icon: <Hash size={17} />, label: "File Tools", items: fileToolsItems },
    { id: "remote", icon: <Link size={17} />, label: "Remote", items: remoteItems },
    ...(entryId ? [{
      id: "open-with",
      icon: <AppWindow size={17} />,
      label: "Open With...",
      disabled: !targetCanOpenWith,
      disabledReason: "Open With is available for files.",
      onRun: () => run(() => void useExplorerStore.getState().openWithSelected(paneId)),
    } satisfies ContextMenuLeafItem] : []),
    { id: "more", icon: <MoreHorizontal size={17} />, label: "More", items: moreItems },
    {
      id: "refresh",
      icon: <RefreshCcw size={17} />,
      label: "Refresh",
      shortcut: shortcut(`${primaryShortcut}+R`),
      onRun: () => run(() => void useExplorerStore.getState().refreshPane(paneId)),
    },
  ];

  return createPortal(
    <>
      <div
        ref={menuRef}
        className={contextMenuStyles.menu}
        style={menuStyle}
        onPointerDown={(event) => event.stopPropagation()}
        role="menu"
      >
        {menuEntries.map((item) => (
          <ContextMenuItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            shortcut={isContextMenuBranch(item) ? undefined : item.shortcut}
            disabled={isContextMenuBranch(item) ? false : item.disabled}
            disabledReason={isContextMenuBranch(item) ? undefined : item.disabledReason}
            submenu={isContextMenuBranch(item)}
            active={submenu?.id === item.id}
            onPointerEnter={(event) => {
              if (isContextMenuBranch(item)) openSubmenu(event, item);
              else setSubmenu(null);
            }}
            onRun={() => {
              if (isContextMenuBranch(item)) return;
              item.onRun();
            }}
          />
        ))}
      </div>
      {submenu ? (
        <div
          ref={submenuRef}
          className={contextMenuStyles.submenu}
          style={{ left: submenu.x, top: submenu.y, maxHeight: submenu.maxHeight }}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
        >
          {submenu.items.map((item) => (
            <ContextMenuItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              shortcut={item.shortcut}
              disabled={item.disabled}
              disabledReason={item.disabledReason}
              onPointerEnter={() => undefined}
              onRun={item.onRun}
            />
          ))}
        </div>
      ) : null}
    </>,
    document.body,
  );
});

function ContextMenuItem(props: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  submenu?: boolean;
  active?: boolean;
  onPointerEnter?: (event: PointerEvent<HTMLButtonElement>) => void;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cx(contextMenuStyles.item, props.active && contextMenuStyles.itemActive)}
      disabled={props.disabled}
      title={props.disabled ? props.disabledReason : undefined}
      aria-haspopup={props.submenu ? "menu" : undefined}
      aria-expanded={props.submenu ? Boolean(props.active) : undefined}
      onPointerEnter={props.onPointerEnter}
      onClick={props.onRun}
    >
      <span className={contextMenuStyles.icon}>{props.icon}</span>
      <span className={contextMenuStyles.label}>{props.label}</span>
      {props.submenu
        ? <ChevronRight className={contextMenuStyles.shortcut} size={15} aria-hidden="true" />
        : props.shortcut ? <span className={contextMenuStyles.shortcut}>{props.shortcut}</span> : null}
    </button>
  );
}

function isArchivePath(path: string) {
  return /\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z|rar)$/i.test(path);
}

async function previewArchive(path: string) {
  const explorer = useExplorerStore.getState();
  try {
    const result = await archiveList({ path });
    explorer.pushNotification(result.message || `Archive has ${result.entries.length} entries.`, "info", 4500);
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

async function extractArchiveHere(path: string) {
  const explorer = useExplorerStore.getState();
  const destinationDir = `${parentPath(path)}/${fileStem(path)}`;
  try {
    const result = await archiveExtract({ archivePath: path, destinationDir });
    explorer.pushNotification(result.message, "success", 4500);
    const paneId = explorer.contextMenu.paneId;
    if (paneId) void explorer.refreshPane(paneId);
  } catch (error) {
    explorer.pushNotification(`Extract failed: ${errorText(error)}`, "error", 5500);
  }
}

async function extractArchiveTo(path: string) {
  const explorer = useExplorerStore.getState();
  const defaultDestination = `${parentPath(path)}/${fileStem(path)}`;
  const destinationDir = window.prompt("Extract archive to folder:", defaultDestination);
  if (!destinationDir?.trim()) return;
  try {
    const result = await archiveExtract({ archivePath: path, destinationDir: destinationDir.trim() });
    explorer.pushNotification(result.message, "success", 4500);
    const paneId = explorer.contextMenu.paneId;
    if (paneId) void explorer.refreshPane(paneId);
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
      explorer.pushNotification("Symlink target copied, but the target does not exist.", "info", 5000);
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
    useExplorerStore.getState().pushNotification(`Terminal unavailable: ${errorText(error)}`, "error", 4500);
  }
}

function parentPath(path: string) {
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "/";
}

function joinLocalPath(root: string, relativePath: string) {
  const normalizedRoot = root.replace(/\/+$/, "");
  const normalizedRelative = relativePath.replace(/^\/+/, "");
  return normalizedRoot === "/" ? `/${normalizedRelative}` : `${normalizedRoot}/${normalizedRelative}`;
}

function fileStem(path: string) {
  const parts = path.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "Archive";
  return name.replace(/\.(zip|tar|tgz|tar\.gz|tar\.bz2|7z|rar)$/i, "").replace(/\.[^.]+$/, "") || "Archive";
}

function primaryShortcutLabel(): string {
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)) return "Cmd";
  return "Ctrl";
}

function selectedActionableEntryCount(pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id) && !entry.isDeleted).length;
}

function selectedFolderEntryCount(pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) =>
    selected.has(entry.id) && !entry.isDeleted && entry.kind === "folder"
  ).length;
}

function selectedRemoteEntryCount(pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) =>
    selected.has(entry.id) && !entry.isDeleted && entry.location.kind === "remote"
  ).length;
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
