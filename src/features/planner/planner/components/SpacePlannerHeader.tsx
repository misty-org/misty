import type { TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { SpaceViewModeToggle } from "@/features/spaces";
import {
  Badge,
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from "@/shared/ui";
import { Plus, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";

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
  // The search field stays collapsed until wanted, but never hides a live query.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showSearch = searchOpen || Boolean(query);
  return (
    <header className="flex min-h-11 flex-wrap items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5">
      <div className="flex items-center gap-3">
        <h1 className="m-0 shrink-0 text-sm font-semibold">Tasks</h1>
        {view && onViewChange ? (
          <SpaceViewModeToggle
            label="Task presentation"
            value={view === "list" ? "list" : "board"}
            options={[
              {
                value: "board",
                label: "Board",
              },
              {
                value: "list",
                label: "List",
              },
            ]}
            onChange={onViewChange}
          />
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {showSearch ? (
          <div className="relative w-44">
            <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-3.5 text-cream-muted" />
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
              <IconButton
                size="xs"
                label="Clear search"
                className="absolute inset-y-0 right-1 my-auto"
                onClick={() => onQuery("")}
              >
                <X className="size-3.5" />
              </IconButton>
            ) : null}
          </div>
        ) : (
          <IconButton label="Search tasks" onClick={() => setSearchOpen(true)}>
            <Search className="size-4" />
          </IconButton>
        )}

        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <IconButton
              label={`Filter tasks${activeFilterCount ? ` (${activeFilterCount} active)` : ""}`}
              tooltip={false}
              className="relative"
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
            </IconButton>
          </PopoverTrigger>
          <PopoverContent className="w-[min(420px,calc(100vw-24px))]" align="end">
            {filters}
          </PopoverContent>
        </Popover>

        <IconButton label="Refresh tasks" className="text-cream-muted/70" onClick={onSync}>
          {loading ? <Spinner label={false} /> : <RotateCw className="size-4" aria-hidden />}
        </IconButton>

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
