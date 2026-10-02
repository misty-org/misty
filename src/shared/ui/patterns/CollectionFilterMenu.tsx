import { Fragment, useState } from "react";
import { ListFilter } from "lucide-react";
import { IconButton } from "../controls/IconButton";
import { Badge } from "../display/Badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "../overlays/DropdownMenu";

export type CollectionFilterGroup = {
  label: string;
  submenu?: boolean;
  kind?: "filter" | "sort";
  defaultValue?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
};

/** One consistent filter trigger; selection indicators come from the shared menu. */
export function CollectionFilterMenu({
  label,
  groups,
  active,
  onReset,
}: {
  label: string;
  groups: CollectionFilterGroup[];
  active: boolean;
  onReset: () => void;
}) {
  const filterCount = groups.filter(
    (group) =>
      group.kind !== "sort" && group.value !== (group.defaultValue ?? group.options[0]?.value),
  ).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={label}
          shape="round"
          className="relative"
          data-active={active || undefined}
          aria-description={`${filterCount} active filters`}
        >
          <ListFilter />
          {filterCount > 0 && (
            <Badge
              aria-hidden="true"
              className="pointer-events-none absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
            >
              {filterCount}
            </Badge>
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {groups.map((group, index) => (
          <Fragment key={group.label}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.submenu ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{group.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <FilterOptions group={group} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <>
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                <FilterOptions group={group} />
              </>
            )}
          </Fragment>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!active} onSelect={onReset}>
          Reset filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterOptions({ group }: { group: CollectionFilterGroup }) {
  return (
    <DropdownMenuRadioGroup
      aria-label={group.label}
      value={group.value}
      onValueChange={group.onChange}
    >
      {group.options.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export type CollectionRefinement = { period: string; sort: string; facet: string };
export const defaultCollectionRefinement: CollectionRefinement = {
  period: "all",
  sort: "default",
  facet: "all",
};

export function refineCollection<T>(
  items: T[],
  state: CollectionRefinement,
  fields: {
    title: (item: T) => string;
    date: (item: T) => string | undefined;
    facet?: (item: T) => string;
  },
  now = Date.now(),
): T[] {
  const timestamp = (item: T) => Date.parse(fields.date(item) ?? "");
  const filtered = items.filter((item) => {
    if (state.facet !== "all" && fields.facet && fields.facet(item) !== state.facet) return false;
    if (state.period === "all") return true;
    const age = now - timestamp(item);
    return age >= 0 && age <= Number(state.period) * 86400000;
  });
  if (state.sort === "name" || state.sort === "name-desc") {
    filtered.sort(
      (a, b) => fields.title(a).localeCompare(fields.title(b)) * (state.sort === "name" ? 1 : -1),
    );
  } else if (state.sort === "recent" || state.sort === "oldest") {
    filtered.sort((a, b) => {
      const aTime = timestamp(a),
        bTime = timestamp(b);
      if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? 1 : 0;
      if (!Number.isFinite(bTime)) return -1;
      return (aTime - bTime) * (state.sort === "oldest" ? 1 : -1);
    });
  }
  return filtered;
}

/** For fully loaded collections; paginated surfaces supply server filters instead. */
export function useCollectionRefinement<T>(
  items: T[],
  options: {
    label: string;
    title: (item: T) => string;
    date: (item: T) => string | undefined;
    dateLabel?: string;
    dateWindow?: boolean;
    defaultOrderLabel?: string;
    facet?: {
      label: string;
      options: { value: string; label: string }[];
      value: (item: T) => string;
    };
  },
) {
  const [state, setState] = useState(defaultCollectionRefinement);
  const active = Object.keys(state).some(
    (key) =>
      state[key as keyof CollectionRefinement] !==
      defaultCollectionRefinement[key as keyof CollectionRefinement],
  );
  const reset = () => setState(defaultCollectionRefinement);
  const groups: CollectionFilterGroup[] = [];
  if (options.facet)
    groups.push({
      label: options.facet.label,
      value: state.facet,
      options: options.facet.options,
      onChange: (facet) => setState((old) => ({ ...old, facet })),
    });
  if (options.dateWindow !== false)
    groups.push({
      label: options.dateLabel ?? "Last activity",
      submenu: true,
      value: state.period,
      options: [
        { value: "all", label: "Any time" },
        { value: "7", label: "Last 7 days" },
        { value: "30", label: "Last 30 days" },
      ],
      onChange: (period) => setState((old) => ({ ...old, period })),
    });
  groups.push({
    label: "Sort by",
    kind: "sort",
    submenu: true,
    value: state.sort,
    options: [
      { value: "default", label: options.defaultOrderLabel ?? "Default order" },
      { value: "recent", label: "Newest first" },
      { value: "oldest", label: "Oldest first" },
      { value: "name", label: "Name A–Z" },
      { value: "name-desc", label: "Name Z–A" },
    ],
    onChange: (sort) => setState((old) => ({ ...old, sort })),
  });
  return {
    sortKey: state.sort,
    items: refineCollection(items, state, { ...options, facet: options.facet?.value }),
    active,
    reset,
    control: (
      <CollectionFilterMenu label={options.label} groups={groups} active={active} onReset={reset} />
    ),
  };
}
