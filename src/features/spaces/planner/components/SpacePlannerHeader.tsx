import type { TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { LoaderCircle, Plus, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui";
import { useSurfacePresentation } from "@/shared/mobile";
import { SpaceViewModeToggle } from "../../components/SpaceViewModeToggle";

/** Compact task controls shared by the Board and List presentations. */
export function SpacePlannerHeader({
  query,
  activeFilterCount,
  loading,
  canManage,
  filters,
  view,
  onViewChange,
  onQuery,
  onSync,
  onCreate,
}: {
  query: string;
  activeFilterCount: number;
  loading: boolean;
  canManage: boolean;
  view?: TaskViewMode;
  onViewChange?: (view: "board" | "list") => void;
  /** Filter controls, shown only when the user opens the popover. */
  filters: ReactNode;
  onQuery: (value: string) => void;
  onSync: () => void;
  onCreate: () => void;
}) {
  const mobile = useSurfacePresentation() !== "desktop";
  // The search field stays collapsed until wanted, but never hides a live query.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showSearch = searchOpen || Boolean(query);

  if (mobile) {
    return (
      <header className="grid shrink-0 gap-2 border-b border-charcoal-border bg-charcoal-bg p-3">
        <div className="flex min-h-11 items-center gap-2">
          {view && onViewChange ? (
            <SpaceViewModeToggle
              label="Task presentation"
              value={view === "list" ? "list" : "board"}
              options={[
                { value: "list", label: "List" },
                { value: "board", label: "Board" },
              ]}
              onChange={onViewChange}
            />
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              className="size-11"
              size="icon"
              variant="ghost"
              onClick={onSync}
              aria-label="Refresh tasks"
            >
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RotateCw className="size-4" />
              )}
            </Button>
            <Button
              className="relative size-11"
              size="icon"
              variant="ghost"
              onClick={() => setFiltersOpen(true)}
              aria-label="Filter tasks"
            >
              <SlidersHorizontal className="size-4" />
              {activeFilterCount ? (
                <Badge
                  className="absolute right-0 top-0 size-4 justify-center p-0 text-[10px]"
                  variant="secondary"
                >
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>
            {canManage ? (
              <Button className="min-h-11" onClick={onCreate}>
                <Plus className="size-4" /> New
              </Button>
            ) : null}
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cream-muted" />
          <Input
            className="h-11 bg-charcoal-card pl-10 pr-10 text-base"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
          />
          {query ? (
            <Button
              className="absolute right-0 top-0 size-11"
              size="icon"
              variant="ghost"
              onClick={() => onQuery("")}
              aria-label="Clear search"
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[88dvh] rounded-t-2xl border-x-0 border-b-0 bg-charcoal-bg px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <SheetHeader>
              <SheetTitle>Filter tasks</SheetTitle>
            </SheetHeader>
            <div className="misty-scrollbar mt-4 max-h-[calc(88dvh-80px)] overflow-y-auto">
              {filters}
            </div>
          </SheetContent>
        </Sheet>
      </header>
    );
  }

  return (
    <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5">
      <div className="flex items-center gap-3">
        <h1 className="m-0 shrink-0 text-sm font-semibold">Tasks</h1>
        {view && onViewChange ? (
          <SpaceViewModeToggle
            label="Task presentation"
            value={view === "list" ? "list" : "board"}
            options={[
              { value: "board", label: "Board" },
              { value: "list", label: "List" },
            ]}
            onChange={onViewChange}
          />
        ) : null}
      </div>

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
                  className="absolute -right-0.5 -top-0.5 size-4 justify-center p-0 text-[10px]"
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
