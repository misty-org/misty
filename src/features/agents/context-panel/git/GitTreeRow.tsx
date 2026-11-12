// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronDown, ChevronRight, Folder, FolderOpen, Minus, Plus, Undo2 } from "lucide-react";
import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import { Checkbox, IconButton, Pressable } from "@/shared/ui";
import { getFileTreeIconSvg } from "../files/fileIcons";
import type { GitTreeDirNode } from "./git-tree";
import type { GitFileEntry } from "./gitApi";

/** The one-letter mark Git uses for each state, shown before the name. */
const LETTERS: Record<GitFileEntry["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  typechange: "T",
};

type SelectedState = "all" | "some" | "none";

const checkedOf = (state: SelectedState) =>
  state === "all" ? true : state === "some" ? "indeterminate" : false;

export interface FileRowProps {
  entry: GitFileEntry;
  style?: CSSProperties;
  indent?: number;
  isSelected?: boolean;
  onToggleSelect?: (path: string) => void;
  actionLabel: string;
  actionKind: "stage" | "unstage";
  /** The untracked group: the file is new to Git. */
  isNew?: boolean;
  /** Only on the folder side (unstaged and untracked); asks before throwing changes away. */
  discardLabel?: string;
  onDiscard?: (path: string) => void;
  onAction: (path: string) => void;
  onOpen: (path: string) => void;
  /** Wraps the row in its right-click menu. */
  menu?: (entry: GitFileEntry, row: ReactNode) => ReactNode;
  actionBusy: boolean;
  /** The name alone, in the tree view; the list shows the whole path. */
  displayName?: string;
}

/** The icon and the name: the folders before it cut from the left, so the file's own name stays. */
function FileNameCell(props: {
  path: string;
  displayName?: string;
  status: string;
  isNew: boolean;
  onOpen: (path: string) => void;
}) {
  const slash = Math.max(props.path.lastIndexOf("/"), props.path.lastIndexOf("\\"));
  const folder = slash > 0 ? props.path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? props.path.slice(slash + 1) : props.path;
  const icon = useMemo(
    () => getFileTreeIconSvg(props.displayName ?? name, false),
    [props.displayName, name],
  );
  return (
    <>
      <span
        className="git-row-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <Pressable
        className="git-name"
        title={props.path}
        aria-label={props.isNew ? `${props.path} (new)` : props.path}
        onClick={() => props.onOpen(props.path)}
      >
        {props.displayName ? (
          <span className="git-name-file" data-git-status={props.status}>
            {props.displayName}
          </span>
        ) : (
          <>
            {folder ? (
              <span className="git-name-dir">
                <bdo dir="ltr">{folder}</bdo>
              </span>
            ) : null}
            <span className="git-name-file" data-git-status={props.status}>
              {name}
            </span>
          </>
        )}
      </Pressable>
    </>
  );
}

/** Added and removed lines at the row's end. */
function FileStats({ entry }: { entry: GitFileEntry }) {
  return (
    <span className="git-stats">
      {entry.additions !== undefined ? <span className="git-added">+{entry.additions}</span> : null}
      {entry.deletions !== undefined && entry.deletions > 0 ? (
        <span className="git-removed">−{entry.deletions}</span>
      ) : null}
    </span>
  );
}

function RowActions(props: {
  paths: string[];
  actionLabel?: string;
  actionKind?: "stage" | "unstage";
  actionBusy: boolean;
  discardLabel?: string;
  onDiscard?: () => void;
  onAction?: () => void;
}) {
  return (
    <div className="git-row-actions">
      {props.discardLabel !== undefined && props.onDiscard ? (
        <IconButton
          label={props.discardLabel}
          size="xs"
          disabled={props.actionBusy}
          onClick={props.onDiscard}
        >
          <Undo2 />
        </IconButton>
      ) : null}
      {props.actionLabel !== undefined && props.onAction ? (
        <IconButton
          label={props.actionLabel}
          size="xs"
          disabled={props.actionBusy}
          onClick={props.onAction}
        >
          {props.actionKind === "stage" ? <Plus /> : <Minus />}
        </IconButton>
      ) : null}
    </div>
  );
}

export const FileRow = memo(function FileRow({
  entry,
  style,
  indent,
  isSelected,
  onToggleSelect,
  actionLabel,
  actionKind,
  isNew = false,
  discardLabel,
  onDiscard,
  onAction,
  onOpen,
  menu,
  actionBusy,
  displayName,
}: FileRowProps) {
  const status = isNew ? "untracked" : entry.status;
  const row = (
    <li
      style={{ ...style, paddingLeft: indent ?? 12 }}
      className="git-row"
      data-git-row={entry.path}
    >
      {onToggleSelect ? (
        <Checkbox
          checked={Boolean(isSelected)}
          onCheckedChange={() => onToggleSelect(entry.path)}
          aria-label={entry.path}
        />
      ) : null}
      <span className="git-letter" data-git-status={status} aria-hidden="true">
        {isNew ? "?" : LETTERS[entry.status]}
      </span>
      <FileNameCell
        path={entry.path}
        displayName={displayName}
        status={status}
        isNew={isNew}
        onOpen={onOpen}
      />
      <FileStats entry={entry} />
      <RowActions
        paths={[entry.path]}
        actionLabel={actionLabel}
        actionKind={actionKind}
        actionBusy={actionBusy}
        discardLabel={discardLabel}
        onDiscard={onDiscard ? () => onDiscard(entry.path) : undefined}
        onAction={() => onAction(entry.path)}
      />
    </li>
  );
  return <>{menu ? menu(entry, row) : row}</>;
});

export interface DirectoryRowProps {
  node: GitTreeDirNode;
  style?: CSSProperties;
  indent?: number;
  isOpen: boolean;
  onToggleOpen: (id: string) => void;
  selectedState: SelectedState;
  onToggleSelect: (paths: string[]) => void;
  actionLabel?: string;
  actionKind?: "stage" | "unstage";
  onAction?: (paths: string[]) => void;
  discardLabel?: string;
  onDiscard?: (paths: string[]) => void;
  actionBusy: boolean;
}

export const DirectoryRow = memo(function DirectoryRow({
  node,
  style,
  indent,
  isOpen,
  onToggleOpen,
  selectedState,
  onToggleSelect,
  actionLabel,
  actionKind,
  onAction,
  discardLabel,
  onDiscard,
  actionBusy,
}: DirectoryRowProps) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const FolderIcon = isOpen ? FolderOpen : Folder;
  return (
    <li style={{ ...style, paddingLeft: indent ?? 12 }} className="git-row">
      <Pressable
        className="git-row-toggle"
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Collapse" : "Expand"} folder ${node.name}`}
        onClick={() => onToggleOpen(node.id)}
      >
        <Chevron size={14} aria-hidden="true" />
      </Pressable>
      <Checkbox
        checked={checkedOf(selectedState)}
        onCheckedChange={() => onToggleSelect(node.allPaths)}
        aria-label={node.path}
      />
      <span className="git-row-icon" data-folder aria-hidden="true">
        <FolderIcon size={15} />
      </span>
      <Pressable className="git-name" title={node.path} onClick={() => onToggleOpen(node.id)}>
        <span className="git-name-file">{node.name}</span>
        <span className="git-name-count">({node.allPaths.length})</span>
      </Pressable>
      <RowActions
        paths={node.allPaths}
        actionLabel={actionLabel}
        actionKind={actionKind}
        actionBusy={actionBusy}
        discardLabel={discardLabel}
        onDiscard={onDiscard ? () => onDiscard(node.allPaths) : undefined}
        onAction={onAction ? () => onAction(node.allPaths) : undefined}
      />
    </li>
  );
});
