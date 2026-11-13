import { Lock, Users } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  OverflowFadeText,
  Pressable,
  Skeleton,
  Surface,
  Text,
  Tooltip,
  cn,
  itemToneClass,
} from "@/shared/ui";
import { homeItemsClass, homeItemsWrapClass } from "./homeLayout";
import type { ItemVisibility } from "../api/visibility";
import { VisibilityMenu } from "../components/VisibilityMenu";
import { editedLabel, type GalleryItem } from "./galleryItems";
import { GalleryPreview, kindIcon } from "./GalleryPreview";
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
  const { Icon, tone, label } = kindIcon[item.kind];
  const isPrivate = props.solo || Boolean(item.private) || item.visibility === "private";
  const Access = isPrivate ? Lock : Users;
  const access = isPrivate
    ? item.private
      ? "Private to the people in this chat"
      : "Private to you"
    : "Shared with everyone in this Space";
  const card = (
    <Surface
      tone={props.selected ? "active" : "card"}
      // A selected card's strong edge stands in for the card's own hairline, which lifts on hover.
      edge={props.selected ? "strong" : "none"}
      radius="xl"
      className="group/card relative min-w-0 overflow-hidden"
    >
      <Pressable
        wash="card"
        onClick={(event) => {
          if (item.remove && props.onSelect) props.onSelect(event, item.key, props.onOpen);
          else props.onOpen();
        }}
        aria-label={`${label}: ${item.title}`}
        className={cn(
          "flex w-full min-w-0 flex-col rounded-xl text-left",
          !props.selected && "border",
        )}
      >
        <Surface as="span" tone="page" className="relative block h-36 border-b">
          <span className="block size-full overflow-hidden">
            <GalleryPreview item={item} spaceId={props.spaceId} />
          </span>
          <Surface
            as="span"
            aria-hidden
            tone="card"
            edge="hairline"
            radius="lg"
            className="absolute -bottom-4 left-4 grid size-9 place-items-center"
          >
            <Icon className={itemToneClass(tone)} />
          </Surface>
        </Surface>
        <span className="block px-4 pb-3.5 pt-7">
          <Text full tone="bright" className="text-base">
            {item.title}
          </Text>
          <Text bare tone="muted" className="mt-1.5 flex items-center gap-1.5 text-sm">
            <Tooltip content={access}>
              <Access aria-label={access} className="size-4 shrink-0" />
            </Tooltip>
            <span aria-hidden>·</span>
            <OverflowFadeText>Edited {editedLabel(item.updatedAt, now)}</OverflowFadeText>
          </Text>
        </span>
      </Pressable>
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
    </Surface>
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
 * 144px preview with the 36px kind tile over its edge, then the title's line and the access line
 * under it, in the home grid's own columns.
 */
export function SpaceItemCardsSkeleton({ cards = 8 }: { cards?: number }) {
  return (
    <div className={homeItemsWrapClass} role="status" aria-label="Space contents" aria-busy="true">
      <span className="sr-only">Space contents</span>
      <div className={homeItemsClass} aria-hidden="true">
        {Array.from({ length: cards }, (_, index) => (
          <Surface key={index} tone="card" radius="xl" className="min-w-0 border">
            <div className="relative h-36 border-b">
              <Skeleton className="absolute -bottom-4 left-4 size-9 rounded-lg" />
            </div>
            <div className="px-4 pb-3.5 pt-7">
              <div className="flex h-6 items-center">
                <Skeleton className={cn("h-4", titleWidths[index % titleWidths.length])} />
              </div>
              <div className="mt-1.5 flex h-5 items-center">
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            </div>
          </Surface>
        ))}
      </div>
    </div>
  );
}
