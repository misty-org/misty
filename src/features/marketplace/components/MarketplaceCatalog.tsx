import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarketplaceCard } from "./MarketplaceCard";
import type { MarketplaceActionHandlers } from "./MarketplacePrimaryAction";
import type { MarketplaceEntry } from "./types";

const pageSize = 50;
const gridClass = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

export function MarketplaceCatalog({
  title,
  description,
  entries,
  empty,
  loading,
  onSelect,
  ...actions
}: MarketplaceActionHandlers & {
  title: string;
  description: string;
  entries: MarketplaceEntry[];
  empty: string;
  loading: boolean;
  onSelect: (pluginId: string) => void;
}) {
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLElement>(null);
  const lastPage = Math.max(0, Math.ceil(entries.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const rangeStart = entries.length ? currentPage * pageSize + 1 : 0;
  const rangeEnd = Math.min((currentPage + 1) * pageSize, entries.length);
  const visibleEntries = useMemo(
    () => entries.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [currentPage, entries],
  );

  useEffect(() => setPage(0), [entries]);

  const changePage = (nextPage: number) => {
    setPage(Math.max(0, Math.min(nextPage, lastPage)));
    scrollRef.current?.scrollIntoView?.({ block: "start" });
  };

  return (
    <section aria-labelledby={`marketplace-catalog-${slug(title)}`} ref={scrollRef}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0">
          <h2
            className="text-base font-semibold text-cream-bright"
            id={`marketplace-catalog-${slug(title)}`}
          >
            {title}
          </h2>
          <p className="mt-1 max-w-[68ch] text-xs leading-5 text-cream-muted">{description}</p>
        </div>
        <div aria-label="Discover pages" className="ml-auto flex shrink-0 items-center gap-1">
          <span aria-live="polite" className="mr-1 text-xs tabular-nums text-cream-muted">
            {loading && entries.length === 0
              ? "Loading"
              : entries.length
                ? `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${entries.length.toLocaleString()}`
                : "0 of 0"}
          </span>
          <Button
            aria-label="Previous page"
            className="size-8 text-cream-muted shadow-none hover:text-cream-bright"
            disabled={loading || currentPage === 0}
            onClick={() => changePage(currentPage - 1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.9} />
          </Button>
          <Button
            aria-label="Next page"
            className="size-8 text-cream-muted shadow-none hover:text-cream-bright"
            disabled={loading || currentPage === lastPage}
            onClick={() => changePage(currentPage + 1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" size={17} strokeWidth={1.9} />
          </Button>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <CatalogSkeleton />
      ) : visibleEntries.length ? (
        <div className={gridClass}>
          {visibleEntries.map((plugin) => (
            <MarketplaceCard
              busy={loading}
              key={plugin.id}
              onOpenDetails={() => onSelect(plugin.id)}
              plugin={plugin}
              {...actions}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-charcoal-border px-5 py-10 text-center text-sm text-cream-muted">
          {empty}
        </div>
      )}
    </section>
  );
}

function CatalogSkeleton() {
  return (
    <div aria-hidden="true" className={gridClass}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Card className="gap-3" key={index} size="sm">
          <div className="flex items-center gap-3 px-4">
            <Skeleton className="size-10 shrink-0 rounded-lg" />
            <span className="grid min-w-0 flex-1 gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </span>
          </div>
          <div className="grid gap-1.5 px-4">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="flex justify-end px-4">
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function slug(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-");
}
