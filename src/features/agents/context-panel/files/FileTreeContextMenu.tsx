// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Globe,
  Link2,
  MessageSquarePlus,
  Pencil,
  Search,
  TextSearch,
  Trash2,
} from "lucide-react";
import { ContextMenuContent, ContextMenuSeparator, MenuItem } from "@/shared/ui";
import { canOpenInBrowser } from "../editor/editorViewMode";
import { parentPath } from "./filesStore";
import type { FileTreeMenuTarget } from "./useFileTreeOperations";

const revealLabel = navigator.platform.includes("Mac")
  ? "Reveal in Finder"
  : navigator.platform.includes("Win")
    ? "Reveal in Explorer"
    : "Reveal in file manager";

/**
 * The tree's right-click menu. Where it opens and how it closes come from the shared context
 * menu; this lists the file actions. New and paste go into the folder itself for a folder's row,
 * and into the folder that holds it for a file's.
 */
export function FileTreeContextMenu({
  target,
  isRoot,
  pasteDisabled,
  onNewFile,
  onNewFolder,
  onSearchFiles,
  onSearchText,
  onCopy,
  onPaste,
  onDuplicate,
  onRename,
  onCopyPath,
  onSendPath,
  onOpenInBrowser,
  onReveal,
  onTrash,
}: {
  target: FileTreeMenuTarget;
  /** The linked folder's own row: it can't be renamed or trashed from here. */
  isRoot: boolean;
  pasteDisabled: boolean;
  onNewFile(dir: string): void;
  onNewFolder(dir: string): void;
  onSearchFiles(dir: string): void;
  onSearchText(dir: string): void;
  onCopy(): void;
  onPaste(dir: string): void;
  onDuplicate(): void;
  onRename(): void;
  onCopyPath(): void;
  onSendPath(): void;
  onOpenInBrowser(): void;
  onReveal(): void;
  onTrash(): void;
}) {
  const dir = target.isDir ? target.path : parentPath(target.path);
  return (
    <ContextMenuContent className="w-56" aria-label={target.path}>
      <MenuItem icon={FilePlus} label="New file" onSelect={() => onNewFile(dir)} />
      <MenuItem icon={FolderPlus} label="New folder" onSelect={() => onNewFolder(dir)} />
      <MenuItem icon={Search} label="Search files" onSelect={() => onSearchFiles(dir)} />
      <MenuItem icon={TextSearch} label="Search in files" onSelect={() => onSearchText(dir)} />
      <ContextMenuSeparator />
      <MenuItem icon={Copy} label="Copy" onSelect={onCopy} />
      <MenuItem
        icon={ClipboardPaste}
        label="Paste"
        disabled={pasteDisabled}
        onSelect={() => onPaste(dir)}
      />
      {!isRoot ? (
        <>
          <MenuItem icon={CopyPlus} label="Duplicate" onSelect={onDuplicate} />
          <MenuItem icon={Pencil} label="Rename" onSelect={onRename} />
        </>
      ) : null}
      <ContextMenuSeparator />
      <MenuItem icon={Link2} label="Copy path" onSelect={onCopyPath} />
      <MenuItem icon={MessageSquarePlus} label="Send to chat" onSelect={onSendPath} />
      {!target.isDir && canOpenInBrowser(target.path) ? (
        <MenuItem icon={Globe} label="Open in browser" onSelect={onOpenInBrowser} />
      ) : null}
      <MenuItem icon={FolderOpen} label={revealLabel} onSelect={onReveal} />
      {!isRoot ? (
        <>
          <ContextMenuSeparator />
          <MenuItem icon={Trash2} label="Move to trash" danger onSelect={onTrash} />
        </>
      ) : null}
    </ContextMenuContent>
  );
}
