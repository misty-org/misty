import { ArrowDownUp, SlidersHorizontal, ChevronUp, ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/shared/ui/dropdown-menu";
import { discoverSortOptions, nextDiscoverSort, type DiscoverSort } from "./discoverSort";
export type { DiscoverSort } from "./discoverSort";
import { discoverCategories, type DiscoverCategory } from "./discoverModel";
export interface DiscoverExtraFilters {
  download: "all" | "downloaded" | "available";
  device: "all" | "desktop" | "mobile";
  updates: boolean;
}
export const defaultDiscoverFilters: DiscoverExtraFilters = {
  download: "all",
  device: "all",
  updates: false,
};
export type DiscoverAccessFilter = "all" | "added" | "available";
export function DiscoverViewControls({
  sort,
  filter,
  onSort,
  onFilter,
  extensions,
  extra,
  onExtra,
  category,
  onCategory,
}: {
  sort: DiscoverSort;
  filter: DiscoverAccessFilter;
  onSort: (sort: DiscoverSort) => void;
  onFilter: (filter: DiscoverAccessFilter) => void;
  extensions: boolean;
  extra: DiscoverExtraFilters;
  onExtra: (filters: DiscoverExtraFilters) => void;
  category: DiscoverCategory;
  onCategory: (category: DiscoverCategory) => void;
}) {
  const active =
    (!extensions && filter !== "all") ||
    extra.download !== "all" ||
    extra.updates ||
    (!extensions && (extra.device !== "all" || category !== "All"));
  const group = (
    label: string,
    value: string,
    options: readonly (readonly [string, string])[],
    change: (value: string) => void,
  ) => (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={change}>
        {options.map(([key, title]) => (
          <DropdownMenuRadioItem
            key={key}
            value={key}
            indicator="check"
            onSelect={(event) => event.preventDefault()}
          >
            {title}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="discover-refresh" aria-label="Sort by" title="Sort by">
            <ArrowDownUp size={16} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              onSort("catalog");
            }}
          >
            Catalog order{" "}
            {sort === "catalog" && <Check className="ml-auto size-4" aria-hidden="true" />}
          </DropdownMenuItem>
          {discoverSortOptions.map(({ field, label }) => {
            const active = sort.startsWith(`${field}-`);
            const ascending = sort.endsWith("-asc");
            const unavailable = extensions && field !== "name" && field !== "publisher";
            return (
              <DropdownMenuItem
                key={field}
                disabled={unavailable}
                aria-label={`${label}: ${active ? (ascending ? "ascending" : "descending") : "off"}`}
                onSelect={(event) => {
                  event.preventDefault();
                  onSort(nextDiscoverSort(sort, field));
                }}
              >
                <span>{label}</span>
                {active ? (
                  ascending ? (
                    <ChevronUp className="ml-auto size-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="ml-auto size-4" aria-hidden="true" />
                  )
                ) : (
                  <span className="ml-auto size-4" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="discover-refresh"
            aria-label="Filter"
            title="Filter"
            data-active={active || undefined}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          className="w-60 max-h-[min(560px,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
        >
          <DropdownMenuItem
            disabled={!active}
            onSelect={(event) => {
              event.preventDefault();
              onFilter("all");
              onExtra(defaultDiscoverFilters);
              onCategory("All");
            }}
          >
            Reset filters
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {group(
            "Download status",
            extra.download,
            [
              ["all", "All downloads"],
              ["downloaded", "Downloaded"],
              ["available", "Not downloaded"],
            ],
            (value) => onExtra({ ...extra, download: value as DiscoverExtraFilters["download"] }),
          )}
          {!extensions && (
            <>
              <DropdownMenuSeparator />
              {group(
                "Space access",
                filter,
                [
                  ["all", "All"],
                  ["added", "Added to this Space"],
                  ["available", "Not in this Space"],
                ],
                (value) => onFilter(value as DiscoverAccessFilter),
              )}
              <DropdownMenuSeparator />
              {group(
                "Category",
                category,
                discoverCategories.map((value) => [value, value] as const),
                (value) => onCategory(value as DiscoverCategory),
              )}
              <DropdownMenuSeparator />
              {group(
                "Works on",
                extra.device,
                [
                  ["all", "Any device"],
                  ["desktop", "Desktop"],
                  ["mobile", "iPhone and iPad"],
                ],
                (value) => onExtra({ ...extra, device: value as DiscoverExtraFilters["device"] }),
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={extra.updates}
            onCheckedChange={(checked) => onExtra({ ...extra, updates: checked === true })}
            onSelect={(event) => event.preventDefault()}
          >
            Updates available
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
