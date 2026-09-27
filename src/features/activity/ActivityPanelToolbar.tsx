import { useRef, useState } from "react";
import { ArrowDownUp, Search, SlidersHorizontal, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  NavIsland,
  NavIslandItem,
} from "@/shared/ui";
import {
  activitySections,
  activityTypes,
  activityStatuses,
  type ActivityView,
  type ActivitySection,
} from "./activityView";

// Filters that are set read as pressed.
const iconButton = "relative";

export function ActivityPanelToolbar({
  view,
  counts,
  onChange,
}: {
  view: ActivityView;
  counts: Record<ActivitySection, number>;
  onChange(view: ActivityView): void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const active = view.types.length > 0 || view.statuses.length > 0;
  return (
    <div className="shrink-0">
      <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-1.5">
        <NavIsland aria-label="Activity sections" className="misty-transient-scrollbar">
          {Object.entries(activitySections).map(([key, label]) => (
            <NavIslandItem
              key={key}
              active={view.section === key}
              onClick={() => onChange({ ...view, section: key as ActivitySection })}
            >
              <span>{label}</span>
              <span className="text-[10px] tabular-nums text-cream-muted">
                {counts[key as ActivitySection]}
              </span>
            </NavIslandItem>
          ))}
        </NavIsland>
        <div className="ml-auto flex shrink-0 items-center gap-1 min-w-0">
          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownMenuTrigger asChild>
              <IconButton
                label="Filter activity"
                tooltip={false}
                className={iconButton}
                data-active={active}
              >
                <SlidersHorizontal size={16} />
                {active && (
                  <span className="absolute right-1 top-1 size-1 rounded-full bg-cream-bright" />
                )}
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              onEscapeKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setFilterOpen(false);
                }
              }}
              align="end"
              className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto"
            >
              <DropdownMenuItem
                disabled={!active}
                onSelect={(event) => {
                  event.preventDefault();
                  onChange({ ...view, types: [], statuses: [] });
                }}
              >
                Reset filters
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Type</DropdownMenuLabel>
              {Object.entries(activityTypes).map(([key, label]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={view.types.includes(key as keyof typeof activityTypes)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...view,
                      types: checked
                        ? [...view.types, key as keyof typeof activityTypes]
                        : view.types.filter((type) => type !== key),
                    })
                  }
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {Object.entries(activityStatuses).map(([key, label]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={view.statuses.includes(key as keyof typeof activityStatuses)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...view,
                      statuses: checked
                        ? [...view.statuses, key as keyof typeof activityStatuses]
                        : view.statuses.filter((status) => status !== key),
                    })
                  }
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
            <DropdownMenuTrigger asChild>
              <IconButton label="Sort activity" tooltip={false} className={iconButton}>
                <ArrowDownUp size={16} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onEscapeKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setSortOpen(false);
                }
              }}
            >
              <DropdownMenuRadioGroup
                value={view.sort}
                onValueChange={(sort) => onChange({ ...view, sort: sort as ActivityView["sort"] })}
              >
                <DropdownMenuRadioItem value="newest">Newest first</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="oldest">Oldest first</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            label="Search activity"
            ref={searchTrigger}
            className={iconButton}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <Search size={16} />
            {view.query && (
              <span className="absolute right-1 top-1 size-1 rounded-full bg-cream-bright" />
            )}
          </IconButton>
        </div>
      </div>
      {searchOpen && (
        <div className="mx-3 mb-1.5 flex h-7 items-center gap-2 rounded-md border border-charcoal-border bg-charcoal-card px-2 text-cream-muted">
          <Search size={16} className="shrink-0 text-cream-muted" aria-hidden="true" />
          <Input
            variant="bare"
            autoFocus
            type="search"
            aria-label="Search activity text"
            placeholder="Search activity"
            className="flex-1 caret-cream-bright"
            value={view.query}
            onChange={(event) => onChange({ ...view, query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onChange({ ...view, query: "" });
                setSearchOpen(false);
                searchTrigger.current?.focus();
              }
            }}
          />
          <IconButton
            label="Clear search"
            className={iconButton}
            onClick={() => onChange({ ...view, query: "" })}
          >
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
