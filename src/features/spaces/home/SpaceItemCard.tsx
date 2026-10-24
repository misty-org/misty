import { Lock, Users } from "lucide-react";
import { Pressable, TooltipHint, cn, itemToneClass } from "@/shared/ui";
import type { ItemVisibility } from "@/api/spaces/visibility";
import { VisibilityMenu } from "../components/VisibilityMenu";
import { editedLabel, type GalleryItem } from "./galleryItems";
import { GalleryPreview, kindIcon } from "./GalleryPreview";
import type { MouseEvent } from "react";

/**
 * One thing in a Space as a card: a live preview, the kind's glyph sitting on its
 * edge, the title, who can see it and when it changed. Its owner's menu carries the
 * Private toggle.
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
}) {
  const { item } = props;
  const { Icon, tone, label } = kindIcon[item.kind];
  const isPrivate = props.solo || Boolean(item.private) || item.visibility === "private";
  const Access = isPrivate ? Lock : Users;
  const access = isPrivate
    ? item.private
      ? "Private to the people in this chat"
      : "Private to you"
    : "Shared with everyone in this Space";
  return (
    <div
      className={cn(
        "group/card relative min-w-0 overflow-hidden rounded-xl border border-charcoal-border",
        props.selected && "border-cream-muted bg-charcoal-active",
        "bg-charcoal-card hover:border-cream-muted/40 focus-within:border-cream-muted/40",
      )}
    >
      <Pressable
        onClick={(event) => {
          if (item.remove && props.onSelect) props.onSelect(event, item.key, props.onOpen);
          else props.onOpen();
        }}
        aria-label={`${label}: ${item.title}`}
        className="flex w-full min-w-0 flex-col text-left"
      >
        <span className="relative block h-36 border-b border-charcoal-border bg-charcoal-workspace">
          <span className="block size-full overflow-hidden">
            <GalleryPreview item={item} spaceId={props.spaceId} />
          </span>
          <span
            aria-hidden
            className={cn(
              "absolute -bottom-4 left-4 grid size-9 place-items-center rounded-lg",
              "border border-charcoal-border bg-charcoal-card",
            )}
          >
            <Icon className={cn("size-4", itemToneClass(tone))} />
          </span>
        </span>
        <span className="block px-4 pb-3.5 pt-7">
          <span className="block truncate text-base text-cream-bright">{item.title}</span>
          <span className="mt-1.5 flex items-center gap-1.5 text-sm text-cream-muted">
            <TooltipHint content={access}>
              <Access aria-label={access} className="size-4 shrink-0" />
            </TooltipHint>
            <span aria-hidden>·</span>
            <span className="truncate">Edited {editedLabel(item.updatedAt)}</span>
          </span>
        </span>
      </Pressable>
      {props.onVisibilityChange && (
        <VisibilityMenu
          label={item.title}
          visibility={item.visibility}
          onChange={props.onVisibilityChange}
          className={cn(
            "absolute right-2 top-2 bg-charcoal-card/90 opacity-0",
            "group-hover/card:opacity-100 group-focus-within/card:opacity-100 data-[state=open]:opacity-100",
          )}
        />
      )}
    </div>
  );
}
