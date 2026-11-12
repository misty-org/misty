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
import { ContextMenuAction, ContextMenuContent, ContextMenuSeparator } from "@/shared/ui";
import { canOpenInBrowser } from "../editor/editorViewMode";
import { parentPath } from "./filesStore";
import type { FileTreeMenuTarget } from "./useFileTreeOperations";

export const revealLabel = navigator.platform.includes("Mac")
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
  const icon = "size-4";
  return (
    <ContextMenuContent className="w-56" aria-label={target.path}>
      <ContextMenuAction
        icon={<FilePlus className={icon} />}
        label="New file"
        onSelect={() => onNewFile(dir)}
      />
      <ContextMenuAction
        icon={<FolderPlus className={icon} />}
        label="New folder"
        onSelect={() => onNewFolder(dir)}
      />
      <ContextMenuAction
        icon={<Search className={icon} />}
        label="Search files"
        onSelect={() => onSearchFiles(dir)}
      />
      <ContextMenuAction
        icon={<TextSearch className={icon} />}
        label="Search in files"
        onSelect={() => onSearchText(dir)}
      />
      <ContextMenuSeparator />
      <ContextMenuAction icon={<Copy className={icon} />} label="Copy" onSelect={onCopy} />
      <ContextMenuAction
        icon={<ClipboardPaste className={icon} />}
        label="Paste"
        disabled={pasteDisabled}
        onSelect={() => onPaste(dir)}
      />
      {!isRoot ? (
        <>
          <ContextMenuAction
            icon={<CopyPlus className={icon} />}
            label="Duplicate"
            onSelect={onDuplicate}
          />
          <ContextMenuAction
            icon={<Pencil className={icon} />}
            label="Rename"
            onSelect={onRename}
          />
        </>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuAction
        icon={<Link2 className={icon} />}
        label="Copy path"
        onSelect={onCopyPath}
      />
      <ContextMenuAction
        icon={<MessageSquarePlus className={icon} />}
        label="Send to chat"
        onSelect={onSendPath}
      />
      {!target.isDir && canOpenInBrowser(target.path) ? (
        <ContextMenuAction
          icon={<Globe className={icon} />}
          label="Open in browser"
          onSelect={onOpenInBrowser}
        />
      ) : null}
      <ContextMenuAction
        icon={<FolderOpen className={icon} />}
        label={revealLabel}
        onSelect={onReveal}
      />
      {!isRoot ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuAction
            icon={<Trash2 className={icon} />}
            label="Move to trash"
            destructive
            onSelect={onTrash}
          />
        </>
      ) : null}
    </ContextMenuContent>
  );
}
