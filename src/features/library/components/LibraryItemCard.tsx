import type { SpaceLibraryItem } from "@/api/spaces/dto/entities";
import {
  Button,
  CollectionCardMetadata,
  CollectionCardTitle,
  IconButton,
  Pressable,
} from "@/shared/ui";
import { Check, EllipsisVertical } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { formatBytes, formatTime } from "../libraryFormat";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { libraryFileTypeLabel, LibraryItemThumbnail } from "../SpaceLibraryPrimitives";

export const ITEM_ACTION_MENU_WIDTH = 224;

/** One Library item in the grid: title, actions, preview and who added it. */
export function LibraryItemCard({
  item,
  creator,
  onContextMenu,
  onShowMenu,
  selected,
  onSelect,
}: {
  item: SpaceLibraryItem;
  creator: string;
  onContextMenu: (event: ReactMouseEvent, itemId: string) => void;
  onShowMenu: (itemId: string, left: number, top: number, anchor?: Element) => void;
  selected: boolean;
  onSelect: (event: ReactMouseEvent, id: string, onOpen: () => void) => void;
}) {
  const {
    data: { spaceId, itemMenu, libraryViewerTriggerRef, setSelectedItemId },
    itemActions: { toggleSelectedItem },
  } = useSpaceLibraryContext();
  const itemSelectionStyle = selected
    ? "inset-ring-2 inset-ring-charcoal-active"
    : "inset-ring-1 inset-ring-cream/10";
  return (
    <article
      className={[
        "group relative min-w-0 rounded-xl bg-charcoal-card p-4",
        "transition-[background-color,box-shadow,opacity] hover:bg-charcoal-hover",
        "flex flex-col",
        itemSelectionStyle,
      ].join(" ")}
      onContextMenu={(event) => onContextMenu(event, item.id)}
    >
      <div className="relative flex h-8 min-w-0 items-center gap-2">
        <CollectionCardTitle title={item.display_name} />
        <LibraryItemActions
          item={item}
          menuOpen={itemMenu?.itemId === item.id}
          onShowMenu={onShowMenu}
        />
      </div>
      <LibraryItemPreview item={item} selected={selected} />
      <CollectionCardMetadata
        category={`${libraryFileTypeLabel(item)} · ${formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))}`}
        updated={formatTime(item.updated_at || item.added_at)}
        creator={creator}
        creatorLabel="Added by"
      />
    </article>
  );
  function LibraryItemPreview({ item, selected }: { item: SpaceLibraryItem; selected: boolean }) {
    return (
      <div className="relative mt-2 w-full min-w-0 flex-1">
        <Pressable
          className="relative grid aspect-[4/3] min-h-32 w-full place-items-center overflow-hidden rounded-lg text-cream-muted [&>svg]:size-10"
          onClick={(event) => {
            onSelect(event, item.id, () => {
              libraryViewerTriggerRef.current = event.currentTarget;
              setSelectedItemId(item.id);
            });
          }}
          aria-label={`Open ${item.display_name}`}
        >
          <LibraryItemThumbnail spaceId={spaceId} item={item} />
        </Pressable>
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
      </div>
    );
  }
}
function LibraryItemActions({
  item,
  menuOpen,
  onShowMenu,
}: {
  item: SpaceLibraryItem;
  menuOpen: boolean;
  onShowMenu: (itemId: string, left: number, top: number, anchor?: Element) => void;
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
      className={[
        "absolute right-0 top-0 flex shrink-0 items-center gap-0.5 rounded-md",
        "bg-charcoal-card group-hover:bg-charcoal-hover transition-opacity",
        actionVisibility,
      ].join(" ")}
      aria-label={`Actions for ${item.display_name}`}
    >
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
