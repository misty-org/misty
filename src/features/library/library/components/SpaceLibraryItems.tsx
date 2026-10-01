import type { LibraryAssetStack, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { useDropZone, usePointerDrag } from "@/features/dnd";
import {
  Button,
  IconButton,
  Pressable,
  CollectionItems,
  CollectionCardTitle,
  CollectionCardMetadata,
} from "@/shared/ui";
import { Check, EllipsisVertical, Star, RotateCcw } from "lucide-react";
import { Fragment, type MouseEvent as ReactMouseEvent } from "react";
import {
  formatBytes,
  formatTime,
  libraryDateGroupLabel,
  normalizeLibraryItemScale,
} from "../libraryFormat";
import { FileNameIcon } from "@/features/file-ui";
import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { libraryFileTypeLabel, LibraryItemThumbnail } from "../SpaceLibraryPrimitives";
const ITEM_ACTION_MENU_WIDTH = 224;
const ITEM_ACTION_MENU_HEIGHT = 336;
const GRID_COLUMN_WIDTHS = [172, 224, 300] as const;
const LIBRARY_ITEM_DRAG_KIND = "library-item";
function clampMenuPosition(left: number, top: number, anchor?: Element) {
  const pane = anchor?.closest<HTMLElement>("[data-workspace-pane]");
  const bounds = pane?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  return {
    left: Math.max(bounds.left + 8, Math.min(left, bounds.right - ITEM_ACTION_MENU_WIDTH - 8)),
    top: Math.max(bounds.top + 8, Math.min(top, bounds.bottom - ITEM_ACTION_MENU_HEIGHT - 8)),
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
      canEditLibrary,
      canCopyLibrary,
      collection,
      setSelectedItemId,
      displayItems,
      sort,
      direction,
      stackByItemID,
      libraryViewMode,
      libraryItemScale,
      selectedItemIds,
      setItemMenu,
      itemMenu,
      nextAfter,
      loadingMore,
    },
    itemActions: { loadMore, restoreItem },
  } = useSpaceLibraryContext();
  const creatorName = useSpaceItemCreator(spaceId);
  const showItemMenu = (itemId: string, left: number, top: number, anchor?: Element) => {
    setItemMenu({
      itemId,
      ...clampMenuPosition(left, top, anchor),
    });
  };
  const openItemContextMenu = (event: ReactMouseEvent, itemId: string) => {
    event.preventDefault();
    event.stopPropagation();
    showItemMenu(itemId, event.clientX, event.clientY, event.currentTarget);
  };
  const itemScale = normalizeLibraryItemScale(libraryItemScale);
  const listLayout = libraryViewMode === "list";
  if (listLayout)
    return (
      <>
        <CollectionItems
          columnSetId={`library:${collection === "deleted" ? "trash" : "items"}`}
          fields={
            collection === "deleted"
              ? ["Size", "Tags", "Deleted", "Recover until"]
              : ["Size", "Tags", "Added"]
          }
          sortResetKey={`${collection}:${sort}:${direction}`}
          categoryLabel="Type"
          creatorLabel="Added by"
          items={displayItems.map((item) => ({
            id: item.id,
            title: item.display_name,
            icon: <FileNameIcon name={item.file.original_filename} size={18} />,
            category: libraryFileTypeLabel(item),
            creator: creatorName(item.added_by_user_id),
            metadata: {
              Size:
                item.file.intrinsic_metadata.byte_size == null
                  ? "—"
                  : formatBytes(Number(item.file.intrinsic_metadata.byte_size)),
              Tags: item.tags?.join(", ") || "—",
              Added: formatTime(item.added_at),
              Deleted: item.trashed_at ? formatTime(item.trashed_at) : "—",
              "Recover until": item.recover_until ? formatTime(item.recover_until) : "—",
            },
            sortValues: {
              Size:
                item.file.intrinsic_metadata.byte_size == null
                  ? undefined
                  : Number(item.file.intrinsic_metadata.byte_size),
              Added: Date.parse(item.added_at),
              Deleted: item.trashed_at ? Date.parse(item.trashed_at) : undefined,
              "Recover until": item.recover_until ? Date.parse(item.recover_until) : undefined,
            },
            creatorDescription: `Added by ${creatorName(item.added_by_user_id)} · Contributed by ${creatorName(item.contributing_user_id)} · Uploaded by ${creatorName(item.file.uploader_user_id)}`,
            updatedAt: item.updated_at || item.added_at,
            updated: formatTime(item.updated_at || item.added_at),
            onOpen: () => setSelectedItemId(item.id),
            actions:
              collection === "deleted" && canEditLibrary ? (
                <Button variant="outline" size="sm" onClick={() => void restoreItem(item)}>
                  <RotateCcw />
                  Restore
                </Button>
              ) : canEditLibrary || canCopyLibrary ? (
                <IconButton
                  label={`More actions for ${item.display_name}`}
                  data-state={itemMenu?.itemId === item.id ? "open" : "closed"}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    showItemMenu(
                      item.id,
                      rect.right - ITEM_ACTION_MENU_WIDTH,
                      rect.bottom + 4,
                      event.currentTarget,
                    );
                  }}
                >
                  <EllipsisVertical />
                </IconButton>
              ) : undefined,
          }))}
        />
        {nextAfter && (
          <Button
            variant="outline"
            className="mx-auto mt-4 flex"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </>
    );
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
              creator={creatorName(item.added_by_user_id)}
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
  creator,
  onContextMenu,
  onShowMenu,
  selected,
}: {
  assetStack?: LibraryAssetStack;
  item: SpaceLibraryItem;
  creator: string;
  onContextMenu: (event: ReactMouseEvent, itemId: string) => void;
  onShowMenu: (itemId: string, left: number, top: number, anchor?: Element) => void;
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
        "group relative min-w-0 rounded-xl bg-charcoal-card p-4",
        "transition-[background-color,box-shadow,opacity] hover:bg-charcoal-hover",
        "flex flex-col",
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
          {
            kind: LIBRARY_ITEM_DRAG_KIND,
            id: item.id,
          },
          <LibraryItemDragPreview name={item.display_name} />,
        );
      }}
    >
      <div className="relative flex h-8 min-w-0 items-center gap-2">
        <CollectionCardTitle title={item.display_name} />
        {canEditLibrary || canCopyLibrary ? (
          <LibraryItemActions
            item={item}
            menuOpen={itemMenu?.itemId === item.id}
            onShowMenu={onShowMenu}
            updateItem={updateItem}
            canEdit={canEditLibrary}
          />
        ) : null}
      </div>
      <LibraryItemPreview
        assetStack={assetStack}
        item={item}
        selected={selected}
        selectionAvailable={canEditLibrary || canCopyLibrary}
      />
      <CollectionCardMetadata
        category={`${libraryFileTypeLabel(item)} · ${formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))}`}
        updated={formatTime(item.updated_at || item.added_at)}
        creator={creator}
        creatorLabel="Added by"
      />
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
      <div className="relative mt-2 w-full min-w-0 flex-1">
        <Pressable
          className="relative grid aspect-[4/3] min-h-32 w-full place-items-center overflow-hidden rounded-lg text-cream-muted [&>svg]:size-10"
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
            <span className="absolute bottom-2 left-2 rounded-md bg-charcoal-workspace px-1.5 py-1 text-[10px] font-semibold capitalize text-cream-bright">
              {assetStackLabel(assetStack)}
            </span>
          ) : null}
        </Pressable>
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
  canEdit,
}: {
  item: SpaceLibraryItem;
  menuOpen: boolean;
  canEdit: boolean;
  onShowMenu: (itemId: string, left: number, top: number, anchor?: Element) => void;
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
      className={`absolute right-0 top-0 flex shrink-0 items-center gap-0.5 rounded-md bg-charcoal-card group-hover:bg-charcoal-hover transition-opacity ${actionVisibility}`}
      aria-label={`Actions for ${item.display_name}`}
    >
      {canEdit && (
        <IconButton
          label={`${item.favorite ? "Remove from favorites" : "Add to favorites"}: ${item.display_name}`}
          tooltip={item.favorite ? "Remove favorite" : "Favorite"}
          onClick={() =>
            void updateItem(item, {
              favorite: !item.favorite,
            })
          }
        >
          <Star size={14} fill={item.favorite ? "currentColor" : "none"} />
        </IconButton>
      )}
      <IconButton
        label={`More actions for ${item.display_name}`}
        tooltip={false}
        aria-haspopup="menu"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onShowMenu(
            item.id,
            rect.right - ITEM_ACTION_MENU_WIDTH,
            rect.bottom + 4,
            event.currentTarget,
          );
        }}
      >
        <EllipsisVertical size={15} />
      </IconButton>
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
    `absolute right-2 top-2 z-10 grid place-items-center rounded-md border shadow-xs ${"size-5"}`,
    "transition-opacity",
    selected ? visibleState : hiddenState,
  ].join(" ");
}
