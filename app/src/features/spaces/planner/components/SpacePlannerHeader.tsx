import { LoaderCircle, Plus, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, Input, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";

/** Compact task controls shared by the Board and List presentations. */
export function SpacePlannerHeader({
  query,
  activeFilterCount,
  loading,
  canManage,
  filters,
  onQuery,
  onSync,
  onCreate,
}: {
  query: string;
  activeFilterCount: number;
  loading: boolean;
  canManage: boolean;
  /** Filter controls, shown only when the user opens the popover. */
  filters: ReactNode;
  onQuery: (value: string) => void;
  onSync: () => void;
  onCreate: () => void;
}) {
  // The search field stays collapsed until wanted, but never hides a live query.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showSearch = searchOpen || Boolean(query);

  return (
    <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5">
      <h1 className="m-0 shrink-0 text-sm font-semibold">Tasks</h1>

      <div className="ml-auto flex items-center gap-3">
        {showSearch ? (
          <div className="relative w-44">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-cream-muted" />
            <Input
              autoFocus
              className="h-8 pl-8 pr-8 text-xs"
              aria-label="Search tasks"
              placeholder="Search tasks"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onBlur={() => !query && setSearchOpen(false)}
            />
            {query ? (
              <Button
                className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
                size="icon"
                variant="ghost"
                type="button"
                onClick={() => onQuery("")}
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            className="size-8"
            size="icon"
            variant="ghost"
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search tasks"
          >
            <Search className="size-4" />
          </Button>
        )}

        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button
              className="relative size-8"
              size="icon"
              variant="ghost"
              type="button"
              aria-label={`Filter tasks${activeFilterCount ? ` (${activeFilterCount} active)` : ""}`}
            >
              <SlidersHorizontal className="size-4" />
              {activeFilterCount ? (
                <Badge
                  className="absolute -right-0.5 -top-0.5 size-4 justify-center p-0 text-[9px]"
                  variant="secondary"
                >
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(420px,calc(100vw-24px))]" align="end">
            {filters}
          </PopoverContent>
        </Popover>

        <Button
          aria-label="Refresh tasks"
          className="size-8 text-cream-muted/70 shadow-none hover:text-cream"
          size="icon"
          title="Refresh tasks"
          variant="ghost"
          type="button"
          onClick={onSync}
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <RotateCw className="size-4" aria-hidden />
          )}
        </Button>

        {canManage ? (
          <Button className="h-8 gap-1.5 text-xs" type="button" onClick={onCreate}>
            <Plus className="size-3.5" />
            New
          </Button>
        ) : null}
      </div>
    </header>
  );
}
