import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderPlus,
  Pencil,
  Plus,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import type { RefObject } from "react";
import {
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  MenuItem,
  MenuTrigger,
  PageHeader,
  PathLine,
  SearchField,
  ToolbarDivider,
  type ActionBarItem,
  type PathLineSegment,
} from "@misty/ui";
import { keys } from "./keyLabels";

export type FilesView = "list" | "grid" | "columns";

export interface ToolbarProps {
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
  /** The enclosing folder, when there is one. */
  up?: () => void;
  path: PathLineSegment[];
  /** New folder and New file, where the open place takes them. */
  create?: (kind: "folder" | "file") => void;
  /** Undo's words now ("Undo Move"), and the step; left out in the picker. */
  undo?: { label?: string; run(): void };
  /** The clipboard and the selection's changes; each left out where it doesn't apply. */
  cut?: () => void;
  copy?: () => void;
  paste?: () => void;
  rename?: () => void;
  trash?: () => void;
  view: FilesView;
  onView(view: FilesView): void;
  /** Columns can show the open place. */
  columns: boolean;
  query: string;
  onQuery(query: string): void;
  searchRef: RefObject<HTMLInputElement | null>;
  searchLabel: string;
}

/** The path's folders, as menu rows, for the bar's ⋯ once the path has folded into it. */
const pathRows = (path: PathLineSegment[]) =>
  path.map((segment, index) => (
    <MenuItem key={segment.id ?? index} label={segment.label} disabled={!segment.onSelect} onSelect={segment.onSelect} />
  ));

/** The New menu's rows: a folder or a file in the open folder. */
function NewRows({ create }: { create(kind: "folder" | "file"): void }) {
  return (
    <>
      <MenuItem icon={FolderPlus} label="New folder" shortcut={keys.newFolder} onSelect={() => create("folder")} />
      <MenuItem icon={FilePlus} label="New file" onSelect={() => create("file")} />
    </>
  );
}

/**
 * Files' top bar, one ActionBar that gives way and never wraps: Back, Forward and the enclosing folder,
 * the path (the one item that fades), New, Undo, the clipboard, Rename and Move to Trash; then, never
 * folding, the view (list, grid, columns) and the search.
 */
export function FilesToolbar(props: ToolbarProps) {
  const items: ActionBarItem[] = [
    {
      id: "back",
      icon: ChevronLeft,
      label: "Back",
      shortcut: keys.back,
      priority: 100,
      disabled: !props.canBack,
      onSelect: props.back,
      render: () => (
        <IconButton label="Back" shortcut={keys.back} disabled={!props.canBack} onClick={props.back}>
          <ChevronLeft />
        </IconButton>
      ),
    },
    {
      id: "forward",
      icon: ChevronRight,
      label: "Forward",
      shortcut: keys.forward,
      priority: 100,
      disabled: !props.canForward,
      onSelect: props.forward,
      render: () => (
        <IconButton label="Forward" shortcut={keys.forward} disabled={!props.canForward} onClick={props.forward}>
          <ChevronRight />
        </IconButton>
      ),
    },
  ];
  if (props.up) {
    const up = props.up;
    items.push({
      id: "up",
      icon: ArrowUp,
      label: "Enclosing folder",
      shortcut: keys.up,
      priority: 90,
      onSelect: up,
      render: () => (
        <IconButton label="Enclosing folder" shortcut={keys.up} onClick={up}>
          <ArrowUp />
        </IconButton>
      ),
    });
  }
  if (props.path.length)
    items.push({
      id: "path",
      icon: ChevronRight,
      label: props.path[props.path.length - 1].label,
      priority: 95,
      shrink: true,
      minWidth: 96,
      menu: pathRows(props.path),
      render: () => <PathLine label="Where this folder is" segments={props.path} />,
    });
  if (props.create) {
    const create = props.create;
    items.push({
      id: "new",
      icon: Plus,
      label: "New",
      priority: 60,
      menu: <NewRows create={create} />,
      render: (mode) => (
        <DropdownMenu>
          <MenuTrigger label="New" icon={Plus} iconOnly={mode === "icon"} />
          <DropdownMenuContent align="start">
            <NewRows create={create} />
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });
  }
  if (props.undo)
    items.push({
      id: "undo",
      icon: Undo2,
      label: props.undo.label ?? "Undo",
      shortcut: keys.undo,
      priority: 50,
      disabled: !props.undo.label,
      onSelect: props.undo.run,
    });
  const optional: [string, ActionBarItem["icon"], string, string | undefined, number, (() => void) | undefined][] = [
    ["cut", Scissors, "Cut", keys.cut, 40, props.cut],
    ["copy", Copy, "Copy", keys.copy, 41, props.copy],
    ["paste", ClipboardPaste, "Paste", keys.paste, 42, props.paste],
    ["rename", Pencil, "Rename", keys.rename, 30, props.rename],
    ["trash", Trash2, "Move to Trash", keys.trash, 35, props.trash],
  ];
  for (const [id, icon, label, shortcut, priority, run] of optional)
    if (run !== undefined) items.push({ id, icon, label, shortcut, priority, onSelect: run });

  return (
    <PageHeader
      className="justify-start"
      actionsLabel="Files"
      actions={items}
      end={
        <>
          <ToolbarDivider />
          <CollectionViewToggle
            value={props.view === "grid" ? "grid" : "list"}
            onChange={props.onView}
            columns={props.columns ? { active: props.view === "columns", onSelect: () => props.onView("columns") } : undefined}
          />
          <ToolbarDivider />
          <SearchField
            ref={props.searchRef}
            aria-label={props.searchLabel}
            placeholder="Search"
            containerClassName="w-48 shrink-0"
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
            onClear={() => props.onQuery("")}
          />
        </>
      }
    />
  );
}
