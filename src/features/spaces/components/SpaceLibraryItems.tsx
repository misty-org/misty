import { Fragment, type MouseEvent as ReactMouseEvent } from "react";
import { Check, EllipsisVertical, Star } from "lucide-react";

import { Button } from "@/ui";
import type {
  LibraryAssetStack,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { formatBytes, formatTime, libraryDateGroupLabel } from "../libraryFormat";
import { LibraryItemThumbnail, libraryFileTypeLabel } from "../SpaceLibraryPrimitives";

const ITEM_ACTION_MENU_WIDTH = 224;
const ITEM_ACTION_MENU_HEIGHT = 336;

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

  return (
    <div
      className="grid gap-3.5"
      style={{
        gridTemplateColumns:
          libraryViewMode === "list" ? "1fr" : "repeat(auto-fill,minmax(270px,1fr))",
      }}
    >
      {displayItems.map((item, itemIndex) => {
        const dateGroup = libraryDateGroupLabel(item, sort);
        const previousDateGroup =
          itemIndex > 0 ? libraryDateGroupLabel(displayItems[itemIndex - 1], sort) : "";
        const assetStack = stackByItemID.get(item.id);
        const listLayout = libraryViewMode === "list";

        return (
          <Fragment key={item.id}>
            {dateGroup && dateGroup !== previousDateGroup ? (
              <h4 className="col-span-full mb-0 mt-3 text-xs font-semibold text-muted-foreground first:mt-0">
                {dateGroup}
              </h4>
            ) : null}
            <LibraryItemCard
              assetStack={assetStack}
              item={item}
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
  listLayout,
  onContextMenu,
  onShowMenu,
  selected,
}: {
  assetStack?: LibraryAssetStack;
  item: SpaceLibraryItem;
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
  const itemCardLayout = listLayout
    ? "grid grid-cols-[132px_minmax(0,1fr)] items-center gap-3"
    : "";
  const itemSelectionStyle = selected ? "ring-2 ring-primary" : "ring-1 ring-foreground/10";

  return (
    <article
      className={[
        "group relative min-w-0 rounded-xl bg-card p-2 shadow-xs",
        "transition-[background-color,box-shadow] hover:bg-accent",
        itemCardLayout,
        itemSelectionStyle,
      ].join(" ")}
      draggable={canReorderAlbum && selectedItemIds.length === 0}
      onContextMenu={(event) => onContextMenu(event, item.id)}
      onDragStart={() => setDraggedAlbumItemId(item.id)}
      onDragEnd={() => setDraggedAlbumItemId("")}
      onDragOver={(event) => {
        if (canReorderAlbum) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        void reorderAlbumItem(item.id);
      }}
    >
      <LibraryItemPreview
        assetStack={assetStack}
        item={item}
        selected={selected}
        selectionAvailable={canEditLibrary || canCopyLibrary}
      />
      <div className={listLayout ? "min-w-0 py-1 pr-1" : "px-1 pb-1 pt-2.5"}>
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <p
              className="m-0 truncate text-xs font-semibold text-foreground"
              title={item.display_name}
            >
              {item.display_name}
            </p>
            <p className="m-0 mt-1 truncate text-[10px] text-muted-foreground">
              {formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))} ·{" "}
              {formatTime(item.added_at)}
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
        <LibraryItemMetadata item={item} listLayout={listLayout} />
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
      <div className="relative min-w-0">
        <Button
          className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-lg border-0 bg-muted text-muted-foreground"
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
            <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-1 text-[9px] font-semibold capitalize text-white">
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
        className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
        type="button"
        onClick={() => void updateItem(item, { favorite: !item.favorite })}
        title={item.favorite ? "Remove favorite" : "Favorite"}
        aria-label={`${item.favorite ? "Remove from favorites" : "Add to favorites"}: ${item.display_name}`}
      >
        <Star size={14} fill={item.favorite ? "currentColor" : "none"} />
      </Button>
      <Button
        className="grid size-7 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
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

function LibraryItemMetadata({
  item,
  listLayout,
}: {
  item: SpaceLibraryItem;
  listLayout: boolean;
}) {
  const rowClassName = listLayout ? "min-w-0" : "flex items-center justify-between gap-3";

  return (
    <dl
      className={`${listLayout ? "mt-3 grid grid-cols-3 gap-x-4" : "mt-3 grid gap-1.5"} text-[10px] leading-4`}
    >
      <LibraryItemMetadataRow label="Size" listLayout={listLayout}>
        {formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))}
      </LibraryItemMetadataRow>
      <LibraryItemMetadataRow label="Date" listLayout={listLayout}>
        {formatTime(item.added_at)}
      </LibraryItemMetadataRow>
      <div className={rowClassName}>
        <dt className="text-muted-foreground">File type</dt>
        <dd className="m-0 truncate text-muted-foreground">{libraryFileTypeLabel(item)}</dd>
      </div>
    </dl>
  );
}

function LibraryItemMetadataRow({
  children,
  label,
  listLayout,
}: {
  children: string;
  label: string;
  listLayout: boolean;
}) {
  return (
    <div className={listLayout ? "min-w-0" : "flex items-center justify-between gap-3"}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate text-muted-foreground">{children}</dd>
    </div>
  );
}

function selectionToggleClassName(selected: boolean) {
  const visibleState = "border-primary bg-primary text-primary-foreground opacity-100";
  const hiddenState = [
    "pointer-events-none border-white/50 bg-black/55 text-transparent opacity-0",
    "group-hover:pointer-events-auto group-hover:opacity-100",
    "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
  ].join(" ");

  return [
    "absolute right-2 top-2 z-10 grid size-5 place-items-center rounded-md border shadow-xs",
    "transition-opacity",
    selected ? visibleState : hiddenState,
  ].join(" ");
}
