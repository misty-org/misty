import type { MouseEvent, ReactNode } from "react";
import { Pressable } from "../../controls/Pressable";
import { Card } from "../../display/Card";
import { OverflowFadeText } from "../../layout/OverflowFadeText";
import { Tooltip } from "../../overlays/Tooltip";
import { cn } from "../../classNames";
import { CollectionItemActions } from "./CollectionItemActions";
import { collectionIconTone, hasItemActions, type CollectionItem } from "./collectionItemTypes";

function CollectionGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(180px,100%),1fr))] gap-3">
      {children}
    </div>
  );
}

/**
 * A card's title: one line (or two with `lines={2}`) that fades at its end only when it doesn't
 * fit, never an ellipsis.
 */
export function CollectionCardTitle({ title, lines = 1 }: { title: string; lines?: 1 | 2 }) {
  return (
    <OverflowFadeText full lines={lines} className="flex-1 text-control font-medium text-cream">
      {title}
    </OverflowFadeText>
  );
}

/**
 * Who made an item. The longer attribution (added, contributed, uploaded by) shows in a tooltip;
 * without one, the name itself shows there when it has faded.
 */
export function CollectionCreator({
  children,
  description,
  className,
}: {
  children: string;
  description?: string;
  className?: string;
}) {
  if (!description)
    return (
      <OverflowFadeText full className={className}>
        {children}
      </OverflowFadeText>
    );
  return (
    <Tooltip content={description}>
      <OverflowFadeText className={className}>{children}</OverflowFadeText>
    </Tooltip>
  );
}

export function CollectionCardMetadata({
  category,
  updated,
  creator,
  creatorDescription,
  creatorLabel = "Created by",
}: {
  category: string;
  updated: string;
  creator?: string;
  creatorDescription?: string;
  creatorLabel?: string;
}) {
  return (
    <span className="mt-3 flex min-w-0 flex-col gap-1 text-meta font-normal text-cream-muted">
      <span className="flex min-w-0 items-center justify-between gap-3">
        <OverflowFadeText full className="flex-1">
          {category}
        </OverflowFadeText>
        <span className="shrink-0 whitespace-nowrap">{updated}</span>
      </span>
      {creator && (
        <CollectionCreator description={creatorDescription}>
          {`${creatorLabel} ${creator}`}
        </CollectionCreator>
      )}
    </span>
  );
}

// A card is the item's surface: it highlights while hovered, focused or picked, and its actions
// sit in one ⋯ at the top right.
const cardClass = cn(
  "group/row relative min-w-0 gap-0 p-0",
  "hover:bg-charcoal-hover has-[:focus-visible]:bg-charcoal-hover",
  "data-[selected]:bg-charcoal-active",
);

export function CollectionItemsGrid({
  items,
  hasCreators,
  creatorLabel,
  layout = "preview",
  titleLines = 1,
  selectedIds = [],
  onSelect,
}: {
  items: CollectionItem[];
  hasCreators: boolean;
  creatorLabel: string;
  layout?: "preview" | "compact";
  /** How many lines a compact card's title may take. */
  titleLines?: 1 | 2;
  selectedIds?: string[];
  onSelect?: (event: MouseEvent, id: string, onOpen: () => void) => void;
}) {
  return (
    <CollectionGrid>
      {items.map((item) => {
        const open = (event: MouseEvent) => {
          if (item.selectable && onSelect) onSelect(event, item.id, item.onOpen);
          else item.onOpen();
        };
        const actions = hasItemActions(item);
        const metadata = (
          <CollectionCardMetadata
            category={item.category}
            updated={item.updated}
            creator={hasCreators ? item.creator || "Unknown" : undefined}
            creatorDescription={item.creatorDescription}
            creatorLabel={creatorLabel}
          />
        );
        return (
          <Card
            key={item.id}
            data-selected={selectedIds.includes(item.id) || undefined}
            className={cardClass}
          >
            {layout === "compact" ? (
              <Pressable
                aria-label={item.title}
                className="flex w-full flex-1 flex-col p-4"
                onClick={open}
              >
                <span className={cn("flex min-h-10 min-w-0 items-center gap-3", actions && "pr-8")}>
                  {item.icon ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-8 shrink-0 place-items-center",
                        "[&_img]:size-8 [&_img]:object-contain [&_svg]:size-6",
                        collectionIconTone(item),
                      )}
                    >
                      {item.icon}
                    </span>
                  ) : null}
                  <CollectionCardTitle title={item.title} lines={titleLines} />
                  {item.marker}
                </span>
                {metadata}
              </Pressable>
            ) : (
              <Pressable
                aria-label={item.title}
                className="flex h-64 w-full flex-col p-4"
                onClick={open}
              >
                <span className={cn("flex h-8 min-w-0 items-center gap-2", actions && "pr-8")}>
                  <CollectionCardTitle title={item.title} />
                  {item.marker}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg",
                    collectionIconTone(item),
                    item.preview
                      ? "[&>img]:size-full [&>img]:object-cover"
                      : "[&_img]:size-10 [&_img]:object-contain [&_svg]:size-10",
                  )}
                >
                  {item.preview ?? item.icon}
                </span>
                {metadata}
              </Pressable>
            )}
            {actions ? (
              // Level with the title line, inside the card's padding.
              <div
                className={cn(
                  "absolute right-3 top-4 flex items-center",
                  layout === "compact" ? "h-10" : "h-8",
                )}
              >
                <CollectionItemActions item={item} />
              </div>
            ) : null}
          </Card>
        );
      })}
    </CollectionGrid>
  );
}
