import { Card, CollectionGrid, Skeleton } from "@/shared/ui";

/** Reserve the same space as the extension content while the catalog loads. */
export function ExtensionLoading({ view }: { view: "grid" | "list" | "detail" }) {
  const bone = "bg-charcoal-border motion-reduce:animate-none";
  return (
    <div
      role="status"
      aria-label={view === "detail" ? "Loading extension" : "Loading Firefox Add-ons"}
    >
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true">
        {view === "detail" ? (
          <div className="flex max-w-3xl flex-col gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex h-10 items-center gap-3">
                <Skeleton className={`size-8 shrink-0 ${bone}`} />
                <Skeleton className={`h-6 w-48 max-w-full ${bone}`} />
              </div>
              <Skeleton className={`h-5 w-4/5 ${bone}`} />
              <div className="flex items-center justify-between gap-4">
                <div className="flex w-48 flex-col gap-2">
                  <Skeleton className={`h-4 w-full ${bone}`} />
                  <Skeleton className={`h-3 w-3/4 ${bone}`} />
                </div>
                <Skeleton className={`h-9 w-20 ${bone}`} />
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-charcoal-border pt-6">
              {["w-full", "w-full", "w-5/6", "w-full", "w-2/3"].map((width, index) => (
                <Skeleton key={index} className={`h-4 ${width} ${bone}`} />
              ))}
            </div>
          </div>
        ) : view === "grid" ? (
          <CollectionGrid>
            {Array.from({ length: 12 }, (_, index) => (
              <Card key={index} className="gap-0 p-4">
                <div className="flex h-10 items-center gap-3">
                  <Skeleton className={`size-8 shrink-0 ${bone}`} />
                  <Skeleton className={`h-4 min-w-0 flex-1 ${bone}`} />
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <Skeleton className={`h-4 w-3/5 ${bone}`} />
                  <Skeleton className={`h-4 w-4/5 ${bone}`} />
                </div>
                <Skeleton className={`mt-3 h-8 w-16 self-end ${bone}`} />
              </Card>
            ))}
          </CollectionGrid>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex h-10 items-center gap-8 border-b border-charcoal-border px-4">
              <Skeleton className={`h-4 w-2/5 ${bone}`} />
              <Skeleton className={`h-4 w-1/5 ${bone}`} />
            </div>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 px-4 py-2.5">
                <Skeleton className={`size-8 shrink-0 ${bone}`} />
                <Skeleton className={`h-4 w-2/5 ${bone}`} />
                <Skeleton className={`h-4 w-1/5 ${bone}`} />
                <Skeleton className={`ml-auto h-8 w-16 ${bone}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
