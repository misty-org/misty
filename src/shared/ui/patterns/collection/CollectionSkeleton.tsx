import { Skeleton } from "../../feedback/Skeleton";
import { cn } from "../../classNames";

const nameWidths = ["w-2/3", "w-1/2", "w-3/5", "w-2/5", "w-3/4"];

/**
 * Fills the collection pane while its first set of items loads, shaped like what arrives: the
 * table's 32px text-first rows under its header, or the grid's cards. It draws more than fit and
 * clips, so it fills any pane without measuring it.
 */
export function CollectionSkeleton({
  label = "Loading items",
  view = "list",
  className,
}: {
  label?: string;
  /** `list` is the table with its header; `rows` the same rows without one; `grid` the cards. */
  view?: "list" | "grid" | "rows";
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={cn(
        "@container relative min-h-80 w-full min-w-0 flex-1 overflow-hidden",
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="absolute inset-0">
        {view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(180px,100%),1fr))] gap-3">
            {Array.from({ length: 24 }, (_, index) => (
              <div
                key={index}
                className="flex h-64 flex-col gap-4 rounded-xl border border-charcoal-border p-4"
              >
                <div className="flex h-8 items-center">
                  <Skeleton className="h-3.5 w-3/4 bg-charcoal-border" />
                </div>
                <Skeleton className="min-h-0 w-full flex-1" />
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-3 w-1/3 bg-charcoal-border" />
                  <Skeleton className="h-3 w-1/4 bg-charcoal-border" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {view === "list" && (
              <div className="flex h-8 items-center gap-8 border-b border-charcoal-border px-4">
                <Skeleton className="h-3 w-1/3 bg-charcoal-border" />
                <Skeleton className="ml-auto hidden h-3 w-1/6 bg-charcoal-border @sm:block" />
                <Skeleton className="hidden h-3 w-1/6 bg-charcoal-border @lg:block" />
              </div>
            )}
            {Array.from({ length: 40 }, (_, index) => (
              <div key={index} className="flex h-8 items-center gap-8 px-4">
                <div className="min-w-0 flex-1">
                  <Skeleton
                    className={cn(
                      "h-3.5 bg-charcoal-border",
                      nameWidths[index % nameWidths.length],
                    )}
                  />
                </div>
                {view === "list" && (
                  <>
                    <Skeleton className="hidden h-3 w-1/6 @sm:block" />
                    <Skeleton className="hidden h-3 w-1/6 @lg:block" />
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
