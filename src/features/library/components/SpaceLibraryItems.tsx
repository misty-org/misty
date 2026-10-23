import { Button, IconButton, CollectionItems, Skeleton, SkeletonList } from "@/shared/ui";
import { EllipsisVertical, RotateCcw } from "lucide-react";
import { Fragment, type MouseEvent as ReactMouseEvent } from "react";
import {
  formatBytes,
  formatTime,
  libraryDateGroupLabel,
  normalizeLibraryItemScale,
} from "../libraryFormat";
import { FileNameIcon } from "@/features/picker";
import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
import { useAgentArtifactCredits } from "../libraryData/useAgentArtifactCredits";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { libraryFileTypeLabel } from "../SpaceLibraryPrimitives";
import { ITEM_ACTION_MENU_WIDTH, LibraryItemCard } from "./LibraryItemCard";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
const ITEM_ACTION_MENU_HEIGHT = 336;
const GRID_COLUMN_WIDTHS = [172, 224, 300] as const;
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
export function SpaceLibraryItems() {
  const {
    data: {
      spaceId,
      canEditLibrary,
      collection,
      setSelectedItemId,
      setSelectedItemIds,
      displayItems,
      sort,
      direction,
      libraryViewMode,
      libraryItemScale,
      selectedItemIds,
      setItemMenu,
      itemMenu,
      nextAfter,
      loadingMore,
      reloadKey,
    },
    itemActions: { loadMore, restoreItem },
  } = useSpaceLibraryContext();
  const personName = useSpaceItemCreator(spaceId);
  const agentCredits = useAgentArtifactCredits(spaceId, reloadKey);
  const selection = useRangeSelection(
    displayItems.map((item) => item.id),
    selectedItemIds,
    setSelectedItemIds,
  );
  /** Files an agent saved credit the agent; everything else the person who added it. */
  const madeBy = (item: (typeof displayItems)[number]) =>
    agentCredits.get(item.id) ?? personName(item.added_by_user_id);
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
            creator: madeBy(item),
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
            creatorDescription: [
              `Added by ${madeBy(item)}`,
              `Contributed by ${personName(item.contributing_user_id)}`,
              `Uploaded by ${personName(item.file.uploader_user_id)}`,
            ].join(" · "),
            updatedAt: item.updated_at || item.added_at,
            updated: formatTime(item.updated_at || item.added_at),
            onOpen: () => setSelectedItemId(item.id),
            selectable: true,
            actions:
              collection === "deleted" && canEditLibrary ? (
                <Button variant="outline" size="sm" onClick={() => void restoreItem(item)}>
                  <RotateCcw />
                  Restore
                </Button>
              ) : (
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
              ),
          }))}
          selectedIds={selectedItemIds}
          onSelect={selection.select}
        />
        {nextAfter && loadingMore ? (
          <SkeletonList label="More items" rows={3} leading="tile" className="mt-1 px-4" />
        ) : nextAfter ? (
          <Button variant="outline" className="mx-auto mt-4 flex" onClick={() => void loadMore()}>
            Load more
          </Button>
        ) : null}
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
        return (
          <Fragment key={item.id}>
            {dateGroup && dateGroup !== previousDateGroup ? (
              <h4 className="col-span-full mb-0 mt-3 text-xs font-semibold text-cream-muted first:mt-0">
                {dateGroup}
              </h4>
            ) : null}
            <LibraryItemCard
              item={item}
              creator={madeBy(item)}
              onContextMenu={openItemContextMenu}
              onShowMenu={showItemMenu}
              selected={selectedItemIds.includes(item.id)}
              onSelect={(event, id, onOpen) => selection.select(event, id, onOpen)}
            />
          </Fragment>
        );
      })}
      {nextAfter && loadingMore
        ? [0, 1, 2, 3].map((tile) => (
            <Skeleton
              key={`more-${tile}`}
              className={listLayout ? "h-14 w-full rounded-lg" : "aspect-square w-full rounded-xl"}
            />
          ))
        : null}
      {nextAfter && !loadingMore ? (
        <div className="col-span-full grid place-items-center pt-3">
          <Button size="sm" variant="outline" type="button" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
