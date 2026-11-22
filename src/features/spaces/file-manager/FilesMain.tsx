import { ClipboardPaste, Eye, FilePlus, Files, FolderInput, FolderPlus, Trash2 } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";
import {
  Button,
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
  type CollectionDrag,
  type CollectionItem,
  type CollectionZoom,
} from "@misty/ui";
import type { FilesView } from "./FilesToolbar";
import { fileColumns } from "./FileItems";
import { keys } from "./keyLabels";
import type { FilesPlace } from "./model";
import type { ListingState } from "./useListing";

/** What an empty place says, by what it is: one quiet line in the list's middle, as Kura's. */
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
    case "space-drive-trash":
      return { line: "The Trash is empty." };
    case "agent-trash":
      return { line: "What agents clean up waits here for you to look over." };
    default:
      return { line: "This folder is empty." };
  }
}

/** The background's own menu: what a right-click on the open folder's empty part offers. */
export interface BackgroundMenu {
  create?: (kind: "folder" | "file") => void;
  paste?: () => void;
  duplicates?: () => void;
  emptyAgentTrash?: () => void;
  goToFolder?: () => void;
  hidden?: { shown: boolean; toggle(): void };
}

function BackgroundRows({ menu }: { menu: BackgroundMenu }) {
  const { create, paste, duplicates, emptyAgentTrash, goToFolder, hidden } = menu;
  return (
    <>
      {goToFolder ? (
        <>
          <MenuItem icon={FolderInput} label="Go to folder" shortcut={keys.goToFolder} onSelect={goToFolder} />
          <MenuSeparator />
        </>
      ) : null}
      {create ? (
        <>
          <MenuItem icon={FolderPlus} label="New folder" shortcut={keys.newFolder} onSelect={() => create("folder")} />
          <MenuItem icon={FilePlus} label="New file" onSelect={() => create("file")} />
        </>
      ) : null}
      {paste ? <MenuItem icon={ClipboardPaste} label="Paste" shortcut={keys.paste} onSelect={paste} /> : null}
      {duplicates ? (
        <>
          <MenuSeparator />
          <MenuItem icon={Files} label="Find duplicates" onSelect={duplicates} />
        </>
      ) : null}
      {emptyAgentTrash ? <MenuItem icon={Trash2} label="Empty agent trash" danger onSelect={emptyAgentTrash} /> : null}
      {hidden ? (
        <>
          <MenuSeparator />
          <MenuCheckItem icon={Eye} label="Show hidden files" checked={hidden.shown} onCheckedChange={hidden.toggle} />
        </>
      ) : null}
    </>
  );
}

/**
 * The open place's items: a skeleton on the first load, an error with Try again, an empty state, or the
 * list or grid (the columns are drawn by the caller). A right-click on the empty part opens the folder's
 * own menu; dragging items moves them (⌥ copies).
 */
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
  onSelect,
  drag,
  background,
  columns,
  scrollRef,
  onKeyDown,
}: {
  place: FilesPlace;
  view: FilesView;
  /** How big the icon view draws its items. */
  zoom: CollectionZoom;
  /** Kura's sort, shared by the ⋯ menu and the list's headers; none keeps folders first. */
  sort: { key: string; descending: boolean } | null;
  onSort(sort: { key: string; descending: boolean } | null): void;
  listing: ListingState & { retry(): void };
  items: CollectionItem[];
  searching: boolean;
  selected: string[];
  onSelect(event: MouseEvent, id: string, onOpen: () => void): void;
  drag?: CollectionDrag;
  background: BackgroundMenu;
  /** The column view, when it is the view. */
  columns?: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}) {
  let body: ReactNode;
  if (listing.status === "loading") body = <CollectionSkeleton label="Reading the folder" view={view === "grid" ? "grid" : "list"} />;
  else if (listing.status === "failed")
    body = (
      <ErrorState
        title="This folder couldn't open"
        line={listing.message}
        action={{ label: "Try again", variant: "secondary", onClick: listing.retry }}
      />
    );
  else if (columns && !searching) body = columns;
  else if (!items.length) body = <EmptyState {...emptyCopy(place, searching)} />;
  else
    body = (
      <>
        <CollectionItems
          view={view === "grid" ? "grid" : "list"}
          columns={fileColumns}
          columnSetId="files"
          remember="files"
          sortResetKey={searching ? "search" : "folder"}
          gridLayout="icons"
          listIcons="inline"
          sort={sort}
          onSortChange={onSort}
          zoom={zoom}
          items={items}
          selectedIds={selected}
          onSelect={onSelect}
          drag={drag}
        />
        {listing.status === "ready" && listing.more ? (
          <div className="flex justify-center py-4">
            <Button variant="secondary" size="md" disabled={listing.loadingMore} onClick={listing.more}>
              Show more
            </Button>
          </div>
        ) : null}
      </>
    );

  const hasMenu = Boolean(background.create || background.paste || background.duplicates || background.emptyAgentTrash);
  const region = (
    <div
      ref={scrollRef}
      role="region"
      aria-label="Items"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={
        columns && !searching
          ? "flex min-h-0 flex-1"
          : view === "grid"
            ? "min-h-0 flex-1 overflow-y-auto px-2 pt-1"
            : // The list sits flush, so its header's hairline and seams meet the pane's edges.
              "min-h-0 flex-1 overflow-y-auto"
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
