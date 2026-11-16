import { Lock, Users } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  ItemCard,
  OverflowFadeText,
  Skeleton,
  Surface,
  Tooltip,
  cn,
  itemToneClass,
} from "@/shared/ui";
import { homeItemsClass, homeItemsWrapClass } from "./homeLayout";
import type { ItemVisibility } from "../api/visibility";
import { VisibilityMenu } from "../components/VisibilityMenu";
import { editedLabel, type GalleryItem } from "./galleryItems";
import { GalleryPreview, itemIcon } from "./GalleryPreview";
import type { MouseEvent, ReactNode } from "react";
import { useNow } from "@/shared/hooks/useNow";

/**
 * One thing in a Space as a card: a live preview, the kind's glyph sitting on its
 * edge, the title, who can see it and when it changed. Its owner's menu carries the
 * Private toggle; right-clicking it removes it, or the whole selection it's part of.
 */
export function SpaceItemCard(props: {
  item: GalleryItem;
  spaceId: string;
  /** Only you are in this Space, so everything in it is private. */
  solo: boolean;
  onOpen(): void;
  /** Set when the viewer owns the item and may make it private or public. */
  onVisibilityChange?(visibility: ItemVisibility): void;
  selected?: boolean;
  onSelect?: (event: MouseEvent, id: string, onOpen: () => void) => void;
  /** The right-click menu, when there is anything to do with the item. */
  contextMenu?: ReactNode;
  onContextMenuOpen?(): void;
}) {
  const now = useNow();
  const { item } = props;
  const { Icon, tone, label } = itemIcon(item);
  const isPrivate = props.solo || Boolean(item.private) || item.visibility === "private";
  const Access = isPrivate ? Lock : Users;
  const access = isPrivate
    ? item.private
      ? "Private to the people in this chat"
      : "Private to you"
    : "Shared with everyone in this Space";
  const card = (
    <ItemCard
      selected={props.selected}
      label={`${label}: ${item.title}`}
      onClick={(event) => {
        if (item.remove && props.onSelect) props.onSelect(event, item.key, props.onOpen);
        else props.onOpen();
      }}
      cover={<GalleryPreview item={item} spaceId={props.spaceId} />}
      glyph={<Icon className={itemToneClass(tone)} />}
      title={item.title}
      meta={
        <>
          <Tooltip content={access}>
            <Access aria-label={access} className="size-4 shrink-0" />
          </Tooltip>
          <span aria-hidden>·</span>
          <OverflowFadeText>Edited {editedLabel(item.updatedAt, now)}</OverflowFadeText>
        </>
      }
    >
      {props.onVisibilityChange && (
        // The menu sits on a card fill so it reads over the preview.
        <Surface
          tone="card"
          radius="md"
          className={cn(
            "absolute right-2 top-2 opacity-0",
            "group-hover/card:opacity-100 group-focus-within/card:opacity-100 has-[[data-state=open]]:opacity-100",
          )}
        >
          <VisibilityMenu
            label={item.title}
            visibility={item.visibility}
            onChange={props.onVisibilityChange}
          />
        </Surface>
      )}
    </ItemCard>
  );
  if (!props.contextMenu) return card;
  return (
    <ContextMenu onOpenChange={(open) => open && props.onContextMenuOpen?.()}>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent>{props.contextMenu}</ContextMenuContent>
    </ContextMenu>
  );
}

const titleWidths = ["w-3/4", "w-2/3", "w-1/2", "w-3/5"];

/**
 * The Space home's cards while its first set of items loads, shaped like `SpaceItemCard`: the
 * cover, then the glyph and title's line and the access line under it, in the home grid's own
 * columns.
 */
export function SpaceItemCardsSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div className={homeItemsWrapClass} role="status" aria-label="Space contents" aria-busy="true">
      <span className="sr-only">Space contents</span>
      <div className={homeItemsClass} aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="min-w-0">
            <Surface tone="card" radius="xl" className="aspect-[16/10] w-full" />
            <div className="px-0.5 pt-2.5">
              <div className="flex h-6 items-center gap-2">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className={cn("h-4", titleWidths[index % titleWidths.length])} />
              </div>
              <div className="mt-1 flex h-5 items-center">
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
