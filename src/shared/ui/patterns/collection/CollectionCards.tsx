import type { ReactElement, ReactNode } from "react";
import type { MouseEvent } from "react";
import { Button } from "../../controls/Button";
import { Card } from "../../display/Card";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "../../overlays/ContextMenu";
import { cn } from "../../utils";
import {
  collectionIconTone,
  collectionUtilityReveal,
  type CollectionItem,
} from "./collectionItemTypes";

export function CollectionGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">{children}</div>
  );
}

/** Fade overflowing titles without replacing the end with an ellipsis. */
export function CollectionCardTitle({ title }: { title: string }) {
  return (
    <span
      title={title}
      className={cn(
        "block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm font-medium text-cream",
        "[mask-image:linear-gradient(to_right,black_calc(100%_-_20px),transparent)]",
      )}
    >
      {title}
    </span>
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
  const attribution = creatorDescription || (creator ? `${creatorLabel} ${creator}` : undefined);
  return (
    <span className="mt-3 flex min-w-0 flex-col gap-1 text-xs font-normal text-cream-muted">
      <span className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate" title={category}>
          {category}
        </span>
        <span className="shrink-0" title={`Last activity: ${updated}`}>
          {updated}
        </span>
      </span>
      {creator && (
        <span className="truncate" title={attribution}>
          {creatorLabel} {creator}
        </span>
      )}
    </span>
  );
}

export function CollectionItemsGrid({
  items,
  hasCreators,
  creatorLabel,
  layout = "preview",
  selectedIds = [],
  onSelect,
}: {
  items: CollectionItem[];
  hasCreators: boolean;
  creatorLabel: string;
  layout?: "preview" | "compact";
  selectedIds?: string[];
  onSelect?: (event: MouseEvent, id: string, onOpen: () => void) => void;
}) {
  return (
    <CollectionGrid>
      {items.map((item) => (
        <CollectionItemSurface key={item.id} item={item}>
          {layout === "compact" ? (
            <Card
              className={cn(
                "group/collection-item min-w-0 gap-0 p-0 hover:bg-charcoal-hover focus-within:bg-charcoal-hover",
                selectedIds.includes(item.id) && "bg-charcoal-active",
              )}
            >
              <Button
                variant="ghost"
                size="none"
                aria-label={item.title}
                className={cn(
                  "w-full flex-1 flex-col items-stretch justify-start gap-0 whitespace-normal",
                  "rounded-none p-4 pb-0 text-left font-normal hover:bg-transparent",
                  "focus-visible:ring-inset",
                )}
                onClick={(event) => {
                  if (item.selectable && onSelect) onSelect(event, item.id, item.onOpen);
                  else item.onOpen();
                }}
              >
                <span className="flex min-h-10 min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-8 shrink-0 place-items-center [&_img]:size-8 [&_img]:object-contain [&_svg]:!size-6",
                      collectionIconTone(item),
                    )}
                  >
                    {item.icon}
                  </span>
                  <span
                    className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium text-cream"
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  {item.marker}
                </span>
                <CollectionCardMetadata
                  category={item.category}
                  updated={item.updated}
                  creator={hasCreators ? item.creator || "Unknown" : undefined}
                  creatorDescription={item.creatorDescription}
                  creatorLabel={creatorLabel}
                />
              </Button>
              {item.actions && (
                <div className="flex justify-end px-4 pt-3 pb-4">{item.actions}</div>
              )}
            </Card>
          ) : (
            <Card
              className={cn(
                "group/collection-item relative gap-0 p-0",
                selectedIds.includes(item.id) && "bg-charcoal-active",
              )}
            >
              <Button
                variant="ghost"
                size="none"
                aria-label={item.title}
                className="h-64 w-full flex-col items-stretch gap-0 whitespace-normal p-4 text-left font-normal"
                onClick={(event) => {
                  if (item.selectable && onSelect) onSelect(event, item.id, item.onOpen);
                  else item.onOpen();
                }}
              >
                <span className={cn("flex h-8 min-w-0 items-center gap-2", item.actions && "pr-8")}>
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
                      : "[&_img]:size-10 [&_img]:object-contain [&_svg]:!size-10",
                  )}
                >
                  {item.preview ?? item.icon}
                </span>
                <CollectionCardMetadata
                  category={item.category}
                  updated={item.updated}
                  creator={hasCreators ? item.creator || "Unknown" : undefined}
                  creatorDescription={item.creatorDescription}
                  creatorLabel={creatorLabel}
                />
              </Button>
              {item.actions && (
                <div
                  className={cn(
                    "absolute right-3 top-4 flex items-center",
                    collectionUtilityReveal,
                  )}
                >
                  {item.actions}
                </div>
              )}
            </Card>
          )}
        </CollectionItemSurface>
      ))}
    </CollectionGrid>
  );
}

export function CollectionItemSurface({
  item,
  children,
}: {
  item: CollectionItem;
  children: ReactElement;
}) {
  return item.contextMenu ? (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>{item.contextMenu}</ContextMenuContent>
    </ContextMenu>
  ) : (
    children
  );
}
