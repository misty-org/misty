import { Skeleton } from "../../feedback/Skeleton";
import { cn } from "../../utils";

/** Fill the available collection pane while its first set of items loads. */
export function CollectionSkeleton({
  label = "Loading items",
  view = "list",
  className,
}: {
  label?: string;
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
                <Skeleton className="h-4 w-3/4 bg-charcoal-border" />
                <Skeleton className="min-h-0 w-full flex-1" />
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-3 w-1/3 bg-charcoal-border" />
                  <Skeleton className="h-3 w-1/4 bg-charcoal-border" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {view === "list" && (
              <div className="flex h-10 items-center gap-8 border-b border-charcoal-border px-4">
                <Skeleton className="h-3 w-1/3 bg-charcoal-border" />
                <Skeleton className="ml-auto hidden h-3 w-1/6 bg-charcoal-border @sm:block" />
                <Skeleton className="hidden h-3 w-1/6 bg-charcoal-border @lg:block" />
              </div>
            )}
            {Array.from({ length: 24 }, (_, index) => (
              <div key={index} className="flex h-14 items-center gap-4 px-4">
                <Skeleton className="size-8 shrink-0 bg-charcoal-border" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton
                    className={cn("h-3.5 bg-charcoal-border", index % 3 === 0 ? "w-2/3" : "w-1/2")}
                  />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                {view === "list" && (
                  <>
                    <Skeleton className="hidden h-3 w-1/6 bg-charcoal-border @sm:block" />
                    <Skeleton className="hidden h-3 w-1/6 bg-charcoal-border @lg:block" />
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
