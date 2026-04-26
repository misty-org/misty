import { Fragment, type MouseEvent as ReactMouseEvent } from "react";
import { Check, EllipsisVertical, Star } from "lucide-react";

import { Button } from "@/ui";
import type {
  LibraryAssetStack,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";

import { useDropZone, usePointerDrag } from "@/features/dnd/PointerDragContext";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import {
  formatBytes,
  formatTime,
  libraryDateGroupLabel,
  normalizeLibraryItemScale,
} from "../libraryFormat";
import { LibraryItemThumbnail, libraryFileTypeLabel } from "../SpaceLibraryPrimitives";

const ITEM_ACTION_MENU_WIDTH = 224;
const ITEM_ACTION_MENU_HEIGHT = 336;

const GRID_COLUMN_WIDTHS = [172, 224, 300] as const;
const LIST_THUMBNAIL_WIDTHS = [96, 132, 176] as const;
const LIBRARY_ITEM_DRAG_KIND = "library-item";

function clampMenuPosition(left: number, top: number) {
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - ITEM_ACTION_MENU_WIDTH - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - ITEM_ACTION_MENU_HEIGHT - 8)),
  };
}

function assetStackLabel(assetStack: LibraryAssetStack) {
  if (assetStack.kind === "live_photo") return "Live";
  if (assetStack.kind === "raw_pair") return "RAW+";
  return `${assetStack.members.length} burst`;
}

export function SpaceLibraryItems() {
  const {
    data: {
      spaceId,
      displayItems,
      sort,
      stackByItemID,
      libraryViewMode,
      libraryItemScale,
      selectedItemIds,
      canEditLibrary,
      canCopyLibrary,
      itemMenu,
      setItemMenu,
      canReorderAlbum,
      setDraggedAlbumItemId,
      libraryViewerTriggerRef,
      setSelectedItemId,
      sensitiveCollectionToken,
      nextAfter,
      loadingMore,
    },
    itemActions: { loadMore, toggleSelectedItem, updateItem },
    collectionActions: { reorderAlbumItem },
  } = useSpaceLibraryContext();

  const showItemMenu = (itemId: string, left: number, top: number) => {
    setItemMenu({
      itemId,
      ...clampMenuPosition(left, top),
    });
  };

  const openItemContextMenu = (event: ReactMouseEvent, itemId: string) => {
    event.preventDefault();
    event.stopPropagation();
    showItemMenu(itemId, event.clientX, event.clientY);
  };

  const itemScale = normalizeLibraryItemScale(libraryItemScale);
  const listLayout = libraryViewMode === "list";

  return (
    <div
      className={listLayout ? "grid gap-2" : "grid gap-3.5"}
      style={{
        gridTemplateColumns: listLayout
          ? "1fr"
          : `repeat(auto-fill,minmax(${GRID_COLUMN_WIDTHS[itemScale]}px,1fr))`,
      }}
    >
      {displayItems.map((item, itemIndex) => {
        const dateGroup = libraryDateGroupLabel(item, sort);
        const previousDateGroup =
          itemIndex > 0 ? libraryDateGroupLabel(displayItems[itemIndex - 1], sort) : "";
        const assetStack = stackByItemID.get(item.id);

        return (
          <Fragment key={item.id}>
            {dateGroup && dateGroup !== previousDateGroup ? (
              <h4 className="col-span-full mb-0 mt-3 text-xs font-semibold text-cream-muted first:mt-0">
                {dateGroup}
              </h4>
            ) : null}
            <LibraryItemCard
              assetStack={assetStack}
              item={item}
              itemScale={itemScale}
              listLayout={listLayout}
              onContextMenu={openItemContextMenu}
              onShowMenu={showItemMenu}
              selected={selectedItemIds.includes(item.id)}
            />
          </Fragment>
        );
      })}
      {nextAfter ? (
        <div className="col-span-full grid place-items-center pt-3">
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LibraryItemCard({
  assetStack,
  item,
  itemScale,
  listLayout,
  onContextMenu,
  onShowMenu,
  selected,
}: {
  assetStack?: LibraryAssetStack;
  item: SpaceLibraryItem;
  itemScale: number;
  listLayout: boolean;
  onContextMenu: (event: ReactMouseEvent, itemId: string) => void;
  onShowMenu: (itemId: string, left: number, top: number) => void;
  selected: boolean;
}) {
  const {
    data: {
      spaceId,
      canEditLibrary,
      canCopyLibrary,
      selectedItemIds,
      itemMenu,
      canReorderAlbum,
      setDraggedAlbumItemId,
      libraryViewerTriggerRef,
      setSelectedItemId,
      sensitiveCollectionToken,
    },
    itemActions: { toggleSelectedItem, updateItem },
    collectionActions: { reorderAlbumItem },
  } = useSpaceLibraryContext();
  const { startDrag, state } = usePointerDrag();
  const reorderable = canReorderAlbum && selectedItemIds.length === 0;
  const dragging = state.payload?.kind === LIBRARY_ITEM_DRAG_KIND && state.payload.id === item.id;
  const dropZone = useDropZone({
    id: `library-item:${item.id}`,
    accepts: (payload) =>
      reorderable && payload.kind === LIBRARY_ITEM_DRAG_KIND && payload.id !== item.id,
    onDrop: (payload) => {
      setDraggedAlbumItemId("");
      void reorderAlbumItem(item.id, payload.id);
    },
  });
  const itemSelectionStyle = selected
    ? "inset-ring-2 inset-ring-charcoal-active"
    : "inset-ring-1 inset-ring-cream/10";

  return (
    <article
      data-misty-window-drag-block={reorderable ? "true" : undefined}
      data-pointer-drag-source={reorderable ? "true" : undefined}
      className={[
        "group relative min-w-0 rounded-xl bg-charcoal-card p-2 shadow-xs",
        "transition-[background-color,box-shadow,opacity] hover:bg-charcoal-hover",
        listLayout ? "flex items-center gap-3" : "flex flex-col",
        reorderable ? "cursor-grab" : "",
        dragging ? "opacity-40" : "",
        dropZone.active ? "ring-2 ring-charcoal-active" : itemSelectionStyle,
      ].join(" ")}
      ref={dropZone.ref}
      onContextMenu={(event) => onContextMenu(event, item.id)}
      onPointerDown={(event) => {
        if (!reorderable) return;
        if ((event.target as HTMLElement).closest("button, input, [role='combobox']")) return;
        startDrag(
          event,
          { kind: LIBRARY_ITEM_DRAG_KIND, id: item.id },
          <LibraryItemDragPreview name={item.display_name} />,
        );
      }}
    >
      <LibraryItemPreview
        assetStack={assetStack}
        item={item}
        selected={selected}
        selectionAvailable={canEditLibrary || canCopyLibrary}
      />
      <div className={listLayout ? "min-w-0 flex-1 py-1 pr-1" : "min-w-0 px-1 pb-1 pt-2.5"}>
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-xs font-semibold text-cream" title={item.display_name}>
              {item.display_name}
            </p>
            <p className="m-0 mt-1 truncate text-[11px] leading-4 text-cream-muted">
              {[
                formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0)),
                libraryFileTypeLabel(item),
                formatTime(item.added_at),
              ].join(" · ")}
            </p>
          </div>
          {canEditLibrary || canCopyLibrary ? (
            <LibraryItemActions
              item={item}
              menuOpen={itemMenu?.itemId === item.id}
              onShowMenu={onShowMenu}
              updateItem={updateItem}
            />
          ) : null}
        </div>
      </div>
    </article>
  );

  function LibraryItemPreview({
    assetStack,
    item,
    selected,
    selectionAvailable,
  }: {
    assetStack?: LibraryAssetStack;
    item: SpaceLibraryItem;
    selected: boolean;
    selectionAvailable: boolean;
  }) {
    return (
      <div
        className={listLayout ? "relative shrink-0" : "relative w-full min-w-0"}
        style={listLayout ? { width: `${LIST_THUMBNAIL_WIDTHS[itemScale]}px` } : undefined}
      >
        <Button
          className={[
            "relative grid aspect-[4/3] h-auto w-full place-items-center overflow-hidden",
            "rounded-lg border-0 bg-charcoal-card p-0 text-cream-muted hover:bg-charcoal-card",
          ].join(" ")}
          variant="ghost"
          type="button"
          onClick={(event) => {
            libraryViewerTriggerRef.current = event.currentTarget;
            setSelectedItemId(item.id);
          }}
          aria-label={`Open ${item.display_name}`}
        >
          <LibraryItemThumbnail
            spaceId={spaceId}
            item={item}
            reauthenticationToken={sensitiveCollectionToken}
          />
          {assetStack ? (
            <span className="absolute bottom-2 left-2 rounded-md bg-charcoal-workspace px-1.5 py-1 text-[9px] font-semibold capitalize text-cream-bright">
              {assetStackLabel(assetStack)}
            </span>
          ) : null}
        </Button>
        {selectionAvailable ? (
          <Button
            className={selectionToggleClassName(selected)}
            type="button"
            aria-label={`${selected ? "Deselect" : "Select"} ${item.display_name}`}
            aria-pressed={selected}
            onClick={(event) => {
              event.stopPropagation();
              toggleSelectedItem(item.id);
            }}
          >
            <Check size={12} />
          </Button>
        ) : null}
      </div>
    );
  }
}

function LibraryItemActions({
  item,
  menuOpen,
  onShowMenu,
  updateItem,
}: {
  item: SpaceLibraryItem;
  menuOpen: boolean;
  onShowMenu: (itemId: string, left: number, top: number) => void;
  updateItem: (
    item: SpaceLibraryItem,
    patch: Partial<Pick<SpaceLibraryItem, "favorite">>,
  ) => Promise<unknown>;
}) {
  const actionVisibility = menuOpen
    ? "pointer-events-auto opacity-100"
    : [
        "pointer-events-none opacity-0",
        "group-hover:pointer-events-auto group-hover:opacity-100",
        "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
      ].join(" ");

  return (
    <div
      className={`flex shrink-0 items-center gap-0.5 transition-opacity ${actionVisibility}`}
      aria-label={`Actions for ${item.display_name}`}
    >
      <Button
        className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-cream-muted hover:bg-charcoal-card hover:text-cream"
        type="button"
        onClick={() => void updateItem(item, { favorite: !item.favorite })}
        title={item.favorite ? "Remove favorite" : "Favorite"}
        aria-label={`${item.favorite ? "Remove from favorites" : "Add to favorites"}: ${item.display_name}`}
      >
        <Star size={14} fill={item.favorite ? "currentColor" : "none"} />
      </Button>
      <Button
        className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-cream-muted hover:bg-charcoal-card hover:text-cream"
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onShowMenu(item.id, rect.right - ITEM_ACTION_MENU_WIDTH, rect.bottom + 4);
        }}
        aria-label={`More actions for ${item.display_name}`}
        aria-haspopup="menu"
      >
        <EllipsisVertical size={15} />
      </Button>
    </div>
  );
}

function LibraryItemDragPreview({ name }: { name: string }) {
  return (
    <div className="max-w-[240px] truncate rounded-lg border border-charcoal-border bg-charcoal-card px-3 py-2 text-xs font-medium text-cream shadow-lg">
      {name}
    </div>
  );
}

function selectionToggleClassName(selected: boolean) {
  const visibleState = "border-charcoal-active bg-charcoal-active text-cream-bright opacity-100";
  const hiddenState = [
    "pointer-events-none border-charcoal-border/50 bg-charcoal-workspace text-transparent opacity-0",
    "group-hover:pointer-events-auto group-hover:opacity-100",
    "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
  ].join(" ");

  return [
    "absolute right-2 top-2 z-10 grid size-5 place-items-center rounded-md border shadow-xs",
    "transition-opacity",
    selected ? visibleState : hiddenState,
  ].join(" ");
}
