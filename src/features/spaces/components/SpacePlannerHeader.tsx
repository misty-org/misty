import { useState, type ReactNode } from "react";
import {
  CalendarDays,
  KanbanSquare,
  List,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { SiGooglecalendar } from "react-icons/si";

import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Input } from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import { Tabs, TabsList, TabsTrigger } from "@/ui";
import type { SpaceCalendarSource } from "@/models/interfaces/features/spaces/types";
import type { TaskViewMode } from "@/models/types/features/spaces/SpacePlanner";

/**
 * The Planner header stays compact while keeping all three established task
 * views directly reachable.
 */
export function SpacePlannerHeader({
  view,
  query,
  activeFilterCount,
  sources,
  loading,
  canManage,
  canManageIntegrations,
  calendarImportAvailable,
  filters,
  onView,
  onQuery,
  onSync,
  onImport,
  onCreate,
}: {
  view: TaskViewMode;
  query: string;
  activeFilterCount: number;
  sources: SpaceCalendarSource[];
  loading: boolean;
  canManage: boolean;
  canManageIntegrations: boolean;
  calendarImportAvailable: boolean;
  /** Filter controls, shown only when the user opens the popover. */
  filters: ReactNode;
  onView: (view: TaskViewMode) => void;
  onQuery: (value: string) => void;
  onSync: () => void;
  onImport: () => void;
  onCreate: () => void;
}) {
  // The search field stays collapsed until wanted, but never hides a live query.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showSearch = searchOpen || Boolean(query);
  const needsAttention = sources.some((source) => source.status !== "active");

  return (
    <header className="misty-spaces-toolbar flex min-h-11 flex-wrap items-center gap-2 px-3 py-1.5">
      <h1 className="sr-only">Planner</h1>
      <Tabs value={view} onValueChange={(next) => onView(next as TaskViewMode)}>
        <TabsList variant="line" className="h-8 p-0" aria-label="Task views">
          <TabsTrigger className="gap-1.5 rounded-sm px-2.5 text-xs" value="board">
            <KanbanSquare className="size-3.5" />
            Board
          </TabsTrigger>
          <TabsTrigger className="gap-1.5 rounded-sm px-2.5 text-xs" value="list">
            <List className="size-3.5" />
            List
          </TabsTrigger>
          <TabsTrigger className="gap-1.5 rounded-sm px-2.5 text-xs" value="calendar">
            <CalendarDays className="size-3.5" />
            Calendar
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="ml-auto flex items-center gap-2">
        {showSearch ? (
          <div className="relative w-44">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Sync planner"
              className="relative size-8 text-muted-foreground/70 shadow-none hover:text-foreground"
              size="icon"
              title="Sync planner"
              variant="ghost"
              type="button"
            >
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCcw className="size-4" aria-hidden />
              )}
              {needsAttention ? (
                <span
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500"
                  aria-hidden
                />
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onSync}>
              <RefreshCcw />
              Sync now
            </DropdownMenuItem>
            {canManageIntegrations && calendarImportAvailable ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onImport}>
                  <SiGooglecalendar />
                  {sources.length ? "Manage calendars" : "Import from Google Calendar"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

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
