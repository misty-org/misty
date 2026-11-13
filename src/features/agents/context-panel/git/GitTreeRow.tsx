// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { ChevronDown, ChevronRight, Folder, FolderOpen, Minus, Plus, Undo2 } from "lucide-react";
import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import {
  ActionBar,
  Checkbox,
  cn,
  iconBarItem,
  Pressable,
  RowTools,
  Surface,
  Text,
  Tooltip,
  type TextTone,
} from "@/shared/ui";
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

/** What Git says of a file, as the color of its letter and name: new, gone or changed. */
function statusTone(status: string): TextTone {
  if (status === "added" || status === "untracked") return "added";
  if (status === "deleted") return "removed";
  return "changed";
}

/** The square an icon or a chevron sits in at the row's start. */
const glyphCell = "grid size-4 flex-none place-items-center";

/** A row of the changes list: 32px, the name taking the room, its actions over its end. */
const rowClass = "group/row relative flex h-8 min-w-0 items-center gap-1.5 pr-2 text-meta";

type SelectedState = "all" | "some" | "none";

const checkedOf = (state: SelectedState) =>
  state === "all" ? true : state === "some" ? "indeterminate" : false;

interface FileRowProps {
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

/** The name's button: it takes the row's room, so a click anywhere on the name opens it. */
const nameButtonClass = "flex min-w-0 flex-1 items-baseline overflow-hidden text-left text-meta";

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
        className={cn("git-row-icon", glyphCell)}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <Tooltip content={props.path}>
        <Pressable
          className={nameButtonClass}
          aria-label={props.isNew ? `${props.path} (new)` : props.path}
          onClick={() => props.onOpen(props.path)}
        >
          {folder && !props.displayName ? (
            <Text tone="muted" dir="rtl" className="text-left">
              <bdo dir="ltr">{folder}</bdo>
            </Text>
          ) : null}
          <Text
            tone={statusTone(props.status)}
            weight="medium"
            className={cn(props.status === "deleted" && "line-through opacity-80")}
            data-git-status={props.status}
          >
            {props.displayName ?? name}
          </Text>
        </Pressable>
      </Tooltip>
    </>
  );
}

/** Added and removed lines at the row's end. */
function FileStats({ entry }: { entry: GitFileEntry }) {
  return (
    <span className="flex flex-none items-center gap-1 text-micro tabular-nums">
      {entry.additions !== undefined ? (
        <Text bare tone="added">
          +{entry.additions}
        </Text>
      ) : null}
      {entry.deletions !== undefined && entry.deletions > 0 ? (
        <Text bare tone="removed">
          −{entry.deletions}
        </Text>
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
  // The actions cover the row's end on hover or focus, so the path keeps the whole width.
  return (
    <RowTools reveal="cover">
      <ActionBar
        label="File actions"
        size="sm"
        width="content"
        items={[
          ...(props.discardLabel !== undefined && props.onDiscard
            ? [
                iconBarItem({
                  id: "discard",
                  icon: Undo2,
                  label: props.discardLabel,
                  size: "sm",
                  priority: 1,
                  disabled: props.actionBusy,
                  onSelect: props.onDiscard,
                }),
              ]
            : []),
          ...(props.actionLabel !== undefined && props.onAction
            ? [
                iconBarItem({
                  id: "action",
                  icon: props.actionKind === "stage" ? Plus : Minus,
                  label: props.actionLabel,
                  size: "sm",
                  priority: 2,
                  disabled: props.actionBusy,
                  onSelect: props.onAction,
                }),
              ]
            : []),
        ]}
      />
    </RowTools>
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
    <Surface
      as="li"
      tone="none"
      wash="row"
      style={{ ...style, paddingLeft: indent ?? 12 }}
      className={rowClass}
      data-git-row={entry.path}
    >
      {onToggleSelect ? (
        <Checkbox
          checked={Boolean(isSelected)}
          onCheckedChange={() => onToggleSelect(entry.path)}
          aria-label={entry.path}
        />
      ) : null}
      <Text
        bare
        tone={statusTone(status)}
        weight="semibold"
        className="w-3.5 flex-none text-center text-micro"
        data-git-status={status}
        aria-hidden="true"
      >
        {isNew ? "?" : LETTERS[entry.status]}
      </Text>
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
    </Surface>
  );
  return <>{menu ? menu(entry, row) : row}</>;
});

interface DirectoryRowProps {
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
    <Surface
      as="li"
      tone="none"
      wash="row"
      style={{ ...style, paddingLeft: indent ?? 12 }}
      className={rowClass}
    >
      <Pressable
        className={glyphCell}
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Collapse" : "Expand"} folder ${node.name}`}
        onClick={() => onToggleOpen(node.id)}
      >
        <Text bare tone="muted" className="flex">
          <Chevron size={14} aria-hidden="true" />
        </Text>
      </Pressable>
      <Checkbox
        checked={checkedOf(selectedState)}
        onCheckedChange={() => onToggleSelect(node.allPaths)}
        aria-label={node.path}
      />
      <Text
        bare
        tone="working"
        className={cn("git-row-icon", glyphCell)}
        data-folder
        aria-hidden="true"
      >
        <FolderIcon size={15} />
      </Text>
      <Tooltip content={node.path}>
        <Pressable className={nameButtonClass} onClick={() => onToggleOpen(node.id)}>
          <Text tone="default" weight="medium">
            {node.name}
          </Text>
          <Text bare tone="muted" className="ml-1.5 flex-none">
            ({node.allPaths.length})
          </Text>
        </Pressable>
      </Tooltip>
      <RowActions
        paths={node.allPaths}
        actionLabel={actionLabel}
        actionKind={actionKind}
        actionBusy={actionBusy}
        discardLabel={discardLabel}
        onDiscard={onDiscard ? () => onDiscard(node.allPaths) : undefined}
        onAction={onAction ? () => onAction(node.allPaths) : undefined}
      />
    </Surface>
  );
});
