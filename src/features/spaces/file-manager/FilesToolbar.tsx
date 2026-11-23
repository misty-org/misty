// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import {
  ArrowRightLeft,
  ArrowUp,
  SquareTerminal,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Eye,
  FilePlus,
  Files,
  FolderPlus,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  RefreshCcw,
  RotateCcw,
  Scissors,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, RefObject } from "react";
import {
  ActionBar,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuCheckItem,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  PathField,
  type ActionBarItem,
  type CollectionZoom,
  type PathFieldSegment,
} from "@misty/ui";
import { FilesSearch, type SearchSuggest } from "./FilesSearch";
import { keys } from "./key_labels";
import type { FilesSort } from "./use_files_browser";

export type FilesView = "list" | "grid" | "columns";

type Run = (() => void) | undefined;

export interface FilesNavBarProps {
  back(): void;
  forward(): void;
  canBack: boolean;
  canForward: boolean;
  up?: () => void;
  refresh(): void;
  path: ReadonlyArray<PathFieldSegment>;
  typed: string;
  onPath?: (text: string) => void;
  pathEdit: number;
  query: string;
  onQuery(query: string): void;
  searchRef: RefObject<HTMLInputElement | null>;
  searchLabel: string;
  suggest?: SearchSuggest;
  onTransfers?: () => void;
}

export function FilesNavBar(props: FilesNavBarProps) {
  return (
    <div className="flex h-12 min-w-0 shrink-0 items-center gap-2 px-3">
      <div role="toolbar" aria-label="Navigation" className="flex shrink-0 items-center gap-1">
        <IconButton
          label="Back"
          shortcut={keys.back}
          disabled={!props.canBack}
          onClick={props.back}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          label="Forward"
          shortcut={keys.forward}
          disabled={!props.canForward}
          onClick={props.forward}
        >
          <ChevronRight />
        </IconButton>
        <IconButton
          label="Enclosing folder"
          shortcut={keys.up}
          disabled={!props.up}
          onClick={props.up}
        >
          <ArrowUp />
        </IconButton>
        <IconButton label="Refresh" onClick={props.refresh}>
          <RefreshCcw />
        </IconButton>
      </div>
      <PathField
        label="Path"
        framed
        className="flex-1"
        segments={props.path}
        value={props.typed}
        onSubmit={props.onPath}
        editRequest={props.pathEdit}
        placeholder="Type a folder's path"
      />
      <FilesSearch
        query={props.query}
        onQuery={props.onQuery}
        searchRef={props.searchRef}
        label={props.searchLabel}
        suggest={props.suggest}
      />
      {props.onTransfers ? (
        <IconButton label="Transfers" onClick={props.onTransfers}>
          <ArrowRightLeft />
        </IconButton>
      ) : null}
    </div>
  );
}

export interface FilesActionBarProps {
  create?: (kind: "folder" | "file") => void;
  undo?: { label?: string; redoLabel?: string; run(): void; redo(): void };
  cut: Run;
  copy: Run;
  paste: Run;
  restore?: { run: Run };
  rename: Run;
  trash: Run;
  view: FilesView;
  onView(view: FilesView): void;
  columns: boolean;
  zoom: CollectionZoom;
  onZoom(zoom: CollectionZoom): void;
  more: ReactNode;
  terminal?: () => void;
}

function NewRows({ create }: { create(kind: "folder" | "file"): void }) {
  return (
    <>
      <MenuLabel>Create in this folder</MenuLabel>
      <MenuItem
        icon={FolderPlus}
        label="Folder"
        shortcut={keys.newFolder}
        onSelect={() => create("folder")}
      />
      <MenuItem icon={FilePlus} label="File" onSelect={() => create("file")} />
    </>
  );
}

export function FilesActionBar(props: FilesActionBarProps) {
  const items: ActionBarItem[] = [];
  if (props.create) {
    const create = props.create;
    items.push({
      id: "new",
      icon: Plus,
      label: "New",
      priority: 100,
      menu: <NewRows create={create} />,
      render: (mode) => (
        <DropdownMenu>
          <MenuTrigger label="New" icon={Plus} iconOnly={mode === "icon"} />
          <DropdownMenuContent align="start" width="sm">
            <NewRows create={create} />
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });
  }
  const tool = (
    id: string,
    icon: LucideIcon,
    label: string,
    shortcut: string | undefined,
    priority: number,
    run: Run,
  ) => {
    const Icon = icon;
    items.push({
      id,
      icon,
      label,
      shortcut,
      priority,
      disabled: !run,
      onSelect: run,
      render: () => (
        <IconButton label={label} shortcut={shortcut} disabled={!run} onClick={run}>
          <Icon />
        </IconButton>
      ),
    });
  };
  if (props.undo) {
    const { label, redoLabel, run, redo } = props.undo;
    tool("undo", Undo2, label ?? "Undo", keys.undo, 60, label ? run : undefined);
    tool("redo", Redo2, redoLabel ?? "Redo", keys.redo, 59, redoLabel ? redo : undefined);
  }
  tool("cut", Scissors, "Cut", keys.cut, 50, props.cut);
  tool("copy", Copy, "Copy", keys.copy, 51, props.copy);
  tool("paste", ClipboardPaste, "Paste", keys.paste, 52, props.paste);
  if (props.restore) tool("restore", RotateCcw, "Put back", undefined, 45, props.restore.run);
  tool("rename", Pencil, "Rename", keys.rename, 40, props.rename);
  tool("trash", Trash2, "Move to Trash", keys.trash, 41, props.trash);

  const grid = props.view === "grid";
  return (
    <div className="flex h-10 min-w-0 shrink-0 items-center px-3">
      <ActionBar
        label="File actions"
        items={items}
        className="min-w-0 flex-1"
        end={
          <div className="flex shrink-0 items-center gap-5">
            <CollectionViewToggle
              value={grid ? "grid" : "list"}
              onChange={props.onView}
              columns={
                props.columns
                  ? { active: props.view === "columns", onSelect: () => props.onView("columns") }
                  : undefined
              }
            />
            <div role="toolbar" aria-label="Item size and more" className="flex items-center gap-1">
              <IconButton
                label="Zoom out"
                disabled={!grid || props.zoom === 0}
                onClick={() => props.onZoom((props.zoom - 1) as CollectionZoom)}
              >
                <Minus />
              </IconButton>
              <IconButton
                label="Zoom in"
                disabled={!grid || props.zoom === 2}
                onClick={() => props.onZoom((props.zoom + 1) as CollectionZoom)}
              >
                <Plus />
              </IconButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="More file actions">
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">{props.more}</DropdownMenuContent>
              </DropdownMenu>
            </div>
            {props.terminal ? (
              <IconButton label="Open terminal" onClick={props.terminal}>
                <SquareTerminal />
              </IconButton>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

export interface FilesMoreMenu {
  sort?: { value: FilesSort | undefined; set(next: FilesSort | undefined): void };
  hidden?: { shown: boolean; toggle(): void };
  refresh(): void;
  copyFolderPath?: () => void;
  copySelectedPath?: () => void;
  duplicates?: () => void;
  emptyAgentTrash?: () => void;
}

const sortRows: { key: FilesSort["key"]; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "modified", label: "Modified" },
  { key: "size", label: "Size" },
  { key: "kind", label: "Kind" },
];

export function MoreRows({ menu }: { menu: FilesMoreMenu }) {
  const sort = menu.sort;
  return (
    <>
      {sort ? (
        <>
          <MenuLabel>Sort</MenuLabel>
          <MenuRadioGroup
            value={sort.value?.key ?? "default"}
            onValueChange={(key) =>
              sort.set(
                key === "default"
                  ? undefined
                  : { key: key as FilesSort["key"], descending: sort.value?.descending ?? false },
              )
            }
          >
            <MenuRadioItem value="default" label="Folders first" />
            {sortRows.map((row) => (
              <MenuRadioItem key={row.key} value={row.key} label={row.label} />
            ))}
          </MenuRadioGroup>
          {sort.value ? (
            <MenuRadioGroup
              value={sort.value.descending ? "descending" : "ascending"}
              onValueChange={(direction) =>
                sort.value && sort.set({ ...sort.value, descending: direction === "descending" })
              }
            >
              <MenuSeparator />
              <MenuRadioItem value="ascending" label="Ascending" />
              <MenuRadioItem value="descending" label="Descending" />
            </MenuRadioGroup>
          ) : null}
          <MenuSeparator />
        </>
      ) : null}
      {menu.hidden ? (
        <>
          <MenuLabel>View</MenuLabel>
          <MenuCheckItem
            icon={Eye}
            label="Show hidden files"
            checked={menu.hidden.shown}
            onCheckedChange={menu.hidden.toggle}
          />
          <MenuSeparator />
        </>
      ) : null}
      <MenuLabel>Location</MenuLabel>
      <MenuItem icon={RefreshCcw} label="Refresh" onSelect={menu.refresh} />
      {menu.copyFolderPath ? (
        <MenuItem icon={ClipboardCopy} label="Copy current path" onSelect={menu.copyFolderPath} />
      ) : null}
      {menu.duplicates ? (
        <MenuItem icon={Files} label="Find duplicates" onSelect={menu.duplicates} />
      ) : null}
      {menu.emptyAgentTrash ? (
        <MenuItem icon={Trash2} label="Empty agent trash" danger onSelect={menu.emptyAgentTrash} />
      ) : null}
      {menu.copySelectedPath ? (
        <>
          <MenuSeparator />
          <MenuLabel>Selection</MenuLabel>
          <MenuItem
            icon={ClipboardCopy}
            label="Copy selected path"
            shortcut={keys.copyPath}
            onSelect={menu.copySelectedPath}
          />
        </>
      ) : null}
    </>
  );
}
