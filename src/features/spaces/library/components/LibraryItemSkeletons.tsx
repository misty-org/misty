import { CollectionSkeleton, Skeleton, Surface, cn } from "@/shared/ui";

/** The narrowest a grid card goes at each item size, the grid's own column minimums. */
export const GRID_COLUMN_WIDTHS = [172, 224, 300] as const;

/** The column minimum for a normalized item size. */
export function gridColumnWidth(scale: number): number {
  return GRID_COLUMN_WIDTHS[scale as 0 | 1 | 2] ?? GRID_COLUMN_WIDTHS[1];
}

const titleWidths = ["w-3/4", "w-2/3", "w-1/2", "w-3/5"];

/**
 * One Library card while it loads, shaped like `LibraryItemCard`: the 32px title row, the 4:3
 * preview under it, and the two 18px lines of what it is and who added it.
 */
export function LibraryCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <Surface
      tone="card"
      edge="hairline"
      radius="xl"
      className="flex min-w-0 flex-col p-4"
      aria-hidden="true"
    >
      <div className="flex h-8 items-center">
        <Skeleton className={cn("h-3.5", titleWidths[index % titleWidths.length])} />
      </div>
      <Skeleton className="mt-2 aspect-[4/3] min-h-32 w-full rounded-lg" />
      <div className="mt-3 grid gap-1">
        <div className="flex h-4.5 items-center justify-between gap-3">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-1/5" />
        </div>
        <div className="flex h-4.5 items-center">
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </Surface>
  );
}

/**
 * The Library's items while its first set loads, in the view it will show: the cards in the
 * grid's columns for the chosen item size, or the list's rows with their icons under its header.
 */
export function LibraryItemsSkeleton({
  view,
  scale,
}: {
  view: "grid" | "list";
  /** The normalized item size, 0 to 2, that picks the grid's column minimum. */
  scale: number;
}) {
  if (view === "list") return <CollectionSkeleton label="Library" view="list" icons />;
  return (
    <div
      className="grid gap-3.5"
      style={{
        gridTemplateColumns: `repeat(auto-fill,minmax(${gridColumnWidth(scale)}px,1fr))`,
      }}
      aria-busy="true"
      role="status"
    >
      <span className="sr-only">Library</span>
      {Array.from({ length: 12 }, (_, index) => (
        <LibraryCardSkeleton key={index} index={index} />
      ))}
    </div>
  );
}
