import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "../../controls/Button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../display/Table";
import { cn } from "../../utils";
import { CollectionItemSurface } from "./CollectionCards";
import {
  collectionIconTone,
  collectionUtilityReveal,
  type CollectionColumn,
  type CollectionItem,
} from "./collectionItemTypes";

export type CollectionSort = { key: string; descending: boolean };

const rowClass = cn(
  "group/collection-item [&>td]:px-4 [&>td]:py-2.5 cursor-pointer border-0 transition-none",
  "[&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg",
  "[--collection-row-highlight:transparent]",
  "hover:[--collection-row-highlight:var(--color-control-hover)] focus-within:[--collection-row-highlight:var(--color-control-hover)]",
  "data-[state=open]:[--collection-row-highlight:var(--color-control-hover)] has-[[data-state=open]]:[--collection-row-highlight:var(--color-control-hover)]",
  "[&>td]:bg-[image:linear-gradient(var(--collection-row-highlight),var(--collection-row-highlight))]",
);

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
      className={column.key === "name" ? "w-full min-w-64 px-2" : "min-w-28 whitespace-nowrap px-2"}
      aria-sort={selected ? (sort.descending ? "descending" : "ascending") : "none"}
    >
      <Button
        variant="ghost"
        size="none"
        justify="start"
        className="group/sort min-h-8 w-full gap-1.5 rounded-sm px-2 py-1 text-inherit font-medium"
        onClick={() =>
          onSort(selected && sort.descending ? null : { key: column.key, descending: selected })
        }
      >
        {column.label}
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0",
            !selected &&
              "opacity-0 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100",
          )}
        />
      </Button>
    </TableHead>
  );
}

export function CollectionItemsTable({
  items,
  columns,
  metadataColumns,
  hasActions,
  stickyActions = false,
  sort,
  onSort,
}: {
  items: CollectionItem[];
  /** Visible columns, including the name column. */
  columns: CollectionColumn[];
  /** Visible columns after the name column. */
  metadataColumns: CollectionColumn[];
  hasActions: boolean;
  stickyActions?: boolean;
  sort: CollectionSort | null;
  onSort: (sort: CollectionSort | null) => void;
}) {
  return (
    <div className="min-w-0 shrink-0 overflow-x-auto">
      <Table unwrapped className="border-separate border-spacing-x-0 border-spacing-y-1">
        <TableHeader>
          <TableRow className="[&>th]:border-b [&>th]:border-charcoal-border [&>th]:px-2">
            {columns.map((column) => (
              <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />
            ))}
            {hasActions && (
              <TableHead
                className={cn(
                  "w-12",
                  stickyActions && "sticky right-0 z-10 bg-charcoal-workspace text-right",
                )}
              >
                <span className={stickyActions ? "px-2" : "sr-only"}>Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <CollectionItemSurface key={item.id} item={item}>
              <TableRow
                className={rowClass}
                onClick={(event) => {
                  if (
                    !(event.target as HTMLElement).closest(
                      "button, a, [role=menuitem], [data-collection-actions]",
                    )
                  )
                    item.onOpen();
                }}
              >
                <TableCell>
                  <Button
                    variant="ghost"
                    size="none"
                    justify="start"
                    aria-label={item.title}
                    className={cn(
                      "min-h-8 w-full gap-3 whitespace-normal border-0 p-0 text-left font-normal",
                      "hover:bg-transparent focus-visible:ring-inset",
                    )}
                    onClick={item.onOpen}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg border",
                        "border-charcoal-border",
                        collectionIconTone(item),
                        "group-hover/collection-item:border-cream-muted group-focus-within/collection-item:border-cream-muted",
                        "group-data-[state=open]/collection-item:border-cream-muted group-has-[[data-state=open]]/collection-item:border-cream-muted",
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 break-words">{item.title}</span>
                    </span>
                    {item.marker}
                  </Button>
                </TableCell>
                {metadataColumns.map((column) => (
                  <TableCell key={column.key} className="text-cream-muted whitespace-nowrap">
                    {column.render(item)}
                  </TableCell>
                ))}
                {hasActions && (
                  <TableCell
                    className={cn(
                      "w-12 whitespace-nowrap text-right [&_button:focus-visible]:ring-inset",
                      stickyActions && "sticky right-0 z-10 bg-charcoal-workspace",
                    )}
                    data-collection-actions
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div
                      className={cn("flex justify-end", !stickyActions && collectionUtilityReveal)}
                    >
                      {item.actions}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            </CollectionItemSurface>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
