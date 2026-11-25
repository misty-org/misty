import {
  ClipboardPaste,
  Eye,
  FilePlus,
  Files,
  FolderInput,
  FolderPlus,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  CollectionItems,
  CollectionSkeleton,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  EmptyState,
  ErrorState,
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  useCollectionDropPlaces,
  type CollectionDrag,
  type CollectionItem,
  type CollectionZoom,
} from "@misty/ui";
import type { FilesView } from "./FilesToolbar";
import { fileColumns } from "./FileItems";
import { keys } from "./key_labels";
import { isSpaceTrashFolder, type FilesPlace } from "./model";

export interface MainListing {
  status: "loading" | "failed" | "ready";
  message?: string;
  retry(): void;
}

function emptyCopy(place: FilesPlace, searching: boolean): { line: string } {
  if (searching) return { line: "No items match this filter." };
  switch (place.kind) {
    case "recent":
      return { line: "Files you open show up here." };
    case "starred":
      return { line: "Star a file or folder to find it here." };
    case "tag":
      return { line: `Nothing is tagged ${place.name}.` };
    case "trash":
      return { line: "The Trash is empty." };
    default:
      return isSpaceTrashFolder(place)
        ? { line: "What anyone deletes in this Space waits here for 30 days." }
        : { line: "This folder is empty." };
  }
}

export interface BackgroundMenu {
  create?: (kind: "folder" | "file") => void;
  paste?: () => void;
  duplicates?: () => void;
  emptyTrash?: () => void;
  goToFolder?: () => void;
  hidden?: { shown: boolean; toggle(): void };
}

function BackgroundRows({ menu }: { menu: BackgroundMenu }) {
  const { create, paste, duplicates, emptyTrash, goToFolder, hidden } = menu;
  return (
    <>
      {goToFolder ? (
        <>
          <MenuItem
            icon={FolderInput}
            label="Go to folder"
            shortcut={keys.goToFolder}
            onSelect={goToFolder}
          />
          <MenuSeparator />
        </>
      ) : null}
      {create ? (
        <>
          <MenuItem
            icon={FolderPlus}
            label="New folder"
            shortcut={keys.newFolder}
            onSelect={() => create("folder")}
          />
          <MenuItem icon={FilePlus} label="New file" onSelect={() => create("file")} />
        </>
      ) : null}
      {paste ? (
        <MenuItem icon={ClipboardPaste} label="Paste" shortcut={keys.paste} onSelect={paste} />
      ) : null}
      {duplicates ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Files} label="Find duplicates" onSelect={duplicates} />
        </>
      ) : null}
      {emptyTrash ? (
        <MenuItem icon={Trash2} label="Empty trash" danger onSelect={emptyTrash} />
      ) : null}
      {hidden ? (
        <>
          <MenuSeparator />
          <MenuCheckItem
            icon={Eye}
            label="Show hidden files"
            checked={hidden.shown}
            onCheckedChange={hidden.toggle}
          />
        </>
      ) : null}
    </>
  );
}

export function FilesMain({
  place,
  view,
  zoom,
  sort,
  onSort,
  listing,
  items,
  searching,
  selected,
  reveal,
  onShownOrder,
  onSelect,
  drag,
  dropHere,
  background,
  columns,
  scrollRef,
  onKeyDown,
}: {
  place: FilesPlace;
  view: FilesView;
  zoom: CollectionZoom;
  sort: { key: string; descending: boolean } | null;
  onSort(sort: { key: string; descending: boolean } | null): void;
  listing: MainListing;
  items: CollectionItem[];
  searching: boolean;
  selected: string[];
  reveal?: string;
  onShownOrder(ids: string[], perRow: number): void;
  onSelect(event: MouseEvent, id: string, onOpen: () => void): void;
  drag?: CollectionDrag;
  dropHere?: {
    canDrop(ids: ReadonlyArray<string>, copy: boolean): boolean;
    onDrop(ids: ReadonlyArray<string>, copy: boolean): void;
  };
  background: BackgroundMenu;
  columns?: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}) {
  const [regionNode, setRegionNode] = useState<HTMLDivElement | null>(null);
  const regionRef = useMemo(() => ({ current: regionNode }), [regionNode]);
  const regionCallback = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      setRegionNode(node);
    },
    [scrollRef],
  );
  useCollectionDropPlaces(regionRef, {
    canDrop: (_place, ids, copy) => Boolean(dropHere?.canDrop(ids, copy)),
    onDrop: (_place, ids, copy) => dropHere?.onDrop(ids, copy),
  });
  let body: ReactNode;
  if (listing.status === "loading")
    body = (
      <CollectionSkeleton label="Reading the folder" view={view === "grid" ? "grid" : "list"} />
    );
  else if (listing.status === "failed")
    body = (
      <ErrorState
        title="This folder couldn't open"
        line={listing.message ?? "This folder couldn't open."}
        action={{ label: "Try again", variant: "secondary", onClick: listing.retry }}
      />
    );
  else if (columns && !searching) body = columns;
  else if (!items.length) body = <EmptyState {...emptyCopy(place, searching)} />;
  else
    body = (
      <CollectionItems
        view={view === "grid" ? "grid" : "list"}
        columns={fileColumns}
        columnSetId="files"
        remember="files"
        sortResetKey={searching ? "search" : "folder"}
        gridLayout="icons"
        listIcons="inline"
        ordered
        sort={sort}
        onSortChange={onSort}
        onShownOrder={onShownOrder}
        reveal={reveal}
        zoom={zoom}
        items={items}
        selectedIds={selected}
        onSelect={onSelect}
        drag={drag}
      />
    );

  const hasMenu = Boolean(
    background.create || background.paste || background.duplicates || background.emptyTrash,
  );
  const region = (
    <div
      ref={regionCallback}
      role="region"
      aria-label="Items"
      data-collection-place={dropHere ? "here" : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={
        columns && !searching
          ? "flex min-h-0 flex-1"
          : view === "grid"
            ? "min-h-0 flex-1 overflow-y-auto px-2 pt-1"
            : "min-h-0 flex-1 overflow-y-auto"
      }
    >
      {body}
    </div>
  );
  if (!hasMenu && !background.hidden) return region;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{region}</ContextMenuTrigger>
      <ContextMenuContent>
        <BackgroundRows menu={background} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
