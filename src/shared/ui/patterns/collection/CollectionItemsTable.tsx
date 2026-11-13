import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { MouseEvent } from "react";
import { Pressable } from "../../controls/Pressable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../display/Table";
import { OverflowFadeText } from "../../layout/OverflowFadeText";
import { cn } from "../../classNames";
import { CollectionItemActions } from "./CollectionItemActions";
import {
  collectionIconTone,
  type CollectionColumn,
  type CollectionItem,
} from "./collectionItemTypes";

export type CollectionSort = { key: string; descending: boolean };

// 32px rows like every other list row. The wash is a gradient laid over each cell's own
// background, so a sticky actions cell keeps its opaque fill under the highlight while the table
// scrolls beneath it.
const rowClass = cn(
  "group/row h-8 cursor-pointer border-0 transition-none",
  "[&>td]:h-8 [&>td]:px-2 [&>td]:py-0",
  "[&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md",
  "[--row-wash:transparent]",
  "hover:[--row-wash:var(--color-control-hover)] focus-within:[--row-wash:var(--color-control-hover)]",
  "data-[state=open]:[--row-wash:var(--color-control-hover)]",
  "has-[[data-state=open]]:[--row-wash:var(--color-control-hover)]",
  "has-[[data-context-open]]:[--row-wash:var(--color-control-hover)]",
  "data-[selected]:[--row-wash:var(--color-control-active)]",
  "[&>td]:bg-[image:linear-gradient(var(--row-wash),var(--row-wash))]",
);

// Rows that start with an icon are taller, so the icon and a two-line title fit.
const iconRowClass = "h-auto [&>td]:h-auto [&>td]:py-0";

function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: CollectionColumn;
  sort: CollectionSort | null;
  onSort: (sort: CollectionSort | null) => void;
}) {
  const selected = sort?.key === column.key;
  const Icon = selected ? (sort.descending ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <TableHead
      className={column.key === "name" ? "w-full min-w-64" : "min-w-28 whitespace-nowrap"}
      aria-sort={selected ? (sort.descending ? "descending" : "ascending") : "none"}
    >
      <Pressable
        className={cn(
          "group/sort flex h-6 w-full min-w-0 items-center gap-1 rounded-sm px-2",
          "font-medium text-cream-muted hover:bg-control-hover hover:text-cream",
          // Focus rings are off app-wide, so keyboard focus shows as the hover wash.
          "focus-visible:bg-control-hover focus-visible:text-cream",
        )}
        onClick={() =>
          onSort(selected && sort.descending ? null : { key: column.key, descending: selected })
        }
      >
        <OverflowFadeText>{column.label}</OverflowFadeText>
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0",
            !selected &&
              "opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
          )}
        />
      </Pressable>
    </TableHead>
  );
}

/** Clicks that belong to a control inside the row, or to a menu portaled out of it. */
function ownClick(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (!event.currentTarget.contains(target)) return false;
  return !target.closest(
    "button, a, input, [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio]",
  );
}

export function CollectionItemsTable({
  items,
  columns,
  metadataColumns,
  hasActions,
  stickyActions = false,
  icons = false,
  sort,
  onSort,
  selectedIds = [],
  onSelect,
}: {
  items: CollectionItem[];
  /** Visible columns, including the name column. */
  columns: CollectionColumn[];
  /** Visible columns after the name column. */
  metadataColumns: CollectionColumn[];
  hasActions: boolean;
  stickyActions?: boolean;
  /** Rows start with the item's icon, bare, and the title may take two lines. */
  icons?: boolean;
  sort: CollectionSort | null;
  onSort: (sort: CollectionSort | null) => void;
  selectedIds?: string[];
  onSelect?: (event: MouseEvent, id: string, onOpen: () => void) => void;
}) {
  return (
    <div className="min-w-0 shrink-0 overflow-x-auto">
      <Table unwrapped className="border-separate border-spacing-x-0 border-spacing-y-0.5">
        <TableHeader>
          <TableRow className="[&>th]:border-b [&>th]:border-charcoal-border [&>th]:px-0">
            {columns.map((column) => (
              <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />
            ))}
            {hasActions && (
              <TableHead
                className={cn(
                  "w-10",
                  stickyActions && "sticky right-0 z-10 bg-charcoal-workspace text-right",
                )}
              >
                <span className={stickyActions ? "px-2" : "sr-only"}>Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const open = (event: MouseEvent) => {
              if (item.selectable && onSelect) onSelect(event, item.id, item.onOpen);
              else item.onOpen();
            };
            return (
              <TableRow
                key={item.id}
                data-selected={selectedIds.includes(item.id) || undefined}
                className={cn(rowClass, icons && iconRowClass)}
                onClick={(event) => {
                  if (ownClick(event)) open(event);
                }}
              >
                <TableCell>
                  <Pressable
                    aria-label={item.title}
                    className={cn(
                      "flex w-full min-w-0 items-center text-cream",
                      icons ? "min-h-12 gap-3 py-2" : "h-8 gap-2",
                    )}
                    onClick={open}
                  >
                    {icons && item.icon ? (
                      <span
                        aria-hidden="true"
                        data-slot="collection-row-icon"
                        className={cn(
                          "grid size-8 shrink-0 place-items-center",
                          "[&_img]:size-5 [&_img]:object-contain [&_svg]:size-5",
                          collectionIconTone(item),
                        )}
                      >
                        {item.icon}
                      </span>
                    ) : null}
                    <OverflowFadeText full lines={icons ? 2 : 1} className="flex-1">
                      {item.title}
                    </OverflowFadeText>
                    {item.marker}
                  </Pressable>
                </TableCell>
                {metadataColumns.map((column) => (
                  <TableCell key={column.key} className="whitespace-nowrap text-cream-muted">
                    {column.render(item)}
                  </TableCell>
                ))}
                {hasActions && (
                  <TableCell
                    className={cn(
                      "w-10 whitespace-nowrap text-right",
                      stickyActions && "sticky right-0 z-10 bg-charcoal-workspace",
                    )}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex justify-end">
                      <CollectionItemActions item={item} />
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
