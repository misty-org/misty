import {
  Archive,
  Copy,
  ExternalLink,
  Eye,
  FileArchive,
  FolderPlus,
  Hash,
  Link,
  Terminal,
} from "lucide-react";
import type { ContextMenuLeafItem } from "@/models/types/features/explorer/desktop/ExplorerContextMenu";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import { useExplorerStore } from "@/stores/explorer";
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
} from "./fileActions";

/** What the archive and file-tool menu groups need from the open context menu. */
export interface ArchiveToolsContext {
  hasRemoteSelection: boolean;
  hasSelection: boolean;
  paneId: string;
  primaryShortcut: string;
  targetEntry: FileEntry | null;
  /** Closes the menu, then performs the action. */
  run: (action: () => void) => void;
  /** Returns the hint text, or undefined when shortcut hints are switched off. */
  shortcut: (value: string) => string | undefined;
}

export function buildArchiveItems(context: ArchiveToolsContext): ContextMenuLeafItem[] {
  const { hasRemoteSelection, hasSelection, paneId, primaryShortcut, run, shortcut, targetEntry } =
    context;
  const selectionDisabledReason = hasSelection ? undefined : "Select a file or folder first.";
  return [
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
}

export function buildFileToolsItems(context: ArchiveToolsContext): ContextMenuLeafItem[] {
  const { hasRemoteSelection, hasSelection, paneId, primaryShortcut, run, shortcut, targetEntry } =
    context;
  const selectionDisabledReason = hasSelection ? undefined : "Select a file or folder first.";
  return [
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
}
