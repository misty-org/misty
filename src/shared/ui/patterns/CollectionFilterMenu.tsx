import { Fragment, useEffect, useState } from "react";
import {
  ArrowDownAZ,
  ArrowDownNarrowWide,
  ArrowDownWideNarrow,
  ArrowDownZA,
  ArrowUpDown,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ListFilter,
  RotateCcw,
} from "lucide-react";
import { IconButton } from "../controls/IconButton";
import { Badge } from "../display/Badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../overlays/DropdownMenu";
import {
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  type MenuIcon,
} from "../overlays/MenuItem";
import { collectionMemory } from "./collection/collectionMemory";

export type CollectionFilterOption = {
  value: string;
  label: string;
  /** The row's 16px icon; the group's icon when left out. */
  icon?: MenuIcon;
};

export type CollectionFilterGroup = {
  label: string;
  /** Shows the group as a submenu row instead of a labelled section. */
  submenu?: boolean;
  kind?: "filter" | "sort";
  /** The group's icon: its submenu row's, and its options' when they have none of their own. */
  icon?: MenuIcon;
  defaultValue?: string;
  value: string;
  options: CollectionFilterOption[];
  onChange: (value: string) => void;
};

/** Every row starts with an icon; a group without its own uses the one for its kind. */
function groupIcon(group: CollectionFilterGroup): MenuIcon {
  return group.icon ?? (group.kind === "sort" ? ArrowUpDown : ListFilter);
}

/**
 * The one filter trigger for a collection: an icon button with a count of the filters that
 * narrow the list (sorting doesn't count), opening a menu whose picks are checkmarked.
 */
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
          className="relative"
          data-active={active || undefined}
          aria-description={`${filterCount} active filters`}
        >
          <ListFilter />
          {filterCount > 0 && (
            <Badge
              variant="count"
              aria-hidden="true"
              className="pointer-events-none absolute -right-1 -top-1"
            >
              {filterCount}
            </Badge>
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {groups.map((group, index) => (
          <Fragment key={group.label}>
            {index > 0 && <MenuSeparator />}
            {group.submenu ? (
              <MenuSubmenu icon={groupIcon(group)} label={group.label}>
                <FilterOptions group={group} />
              </MenuSubmenu>
            ) : (
              <>
                <MenuLabel>{group.label}</MenuLabel>
                <FilterOptions group={group} />
              </>
            )}
          </Fragment>
        ))}
        <MenuSeparator />
        <MenuItem icon={RotateCcw} label="Reset filters" disabled={!active} onSelect={onReset} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterOptions({ group }: { group: CollectionFilterGroup }) {
  const fallback = groupIcon(group);
  return (
    <MenuRadioGroup aria-label={group.label} value={group.value} onValueChange={group.onChange}>
      {group.options.map((option) => (
        <MenuRadioItem
          key={option.value}
          icon={option.icon ?? fallback}
          value={option.value}
          label={option.label}
        />
      ))}
    </MenuRadioGroup>
  );
}

type CollectionRefinement = { period: string; sort: string; facet: string };
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
    /**
     * A facet value to show now, such as one a link asked for; each new value is applied once.
     * With `remember` it shows only while asked for and never replaces the saved choice.
     */
    requestedFacet?: string;
    facet?: {
      label: string;
      /** Options may carry their own icons; otherwise each row gets the filter icon. */
      options: CollectionFilterOption[];
      value: (item: T) => string;
    };
    /** Keeps the person's picks in `misty.db` under this key; without it they last for the page. */
    remember?: string;
  },
) {
  const { remember } = options;
  const [local, setLocal] = useState(() => ({
    ...defaultCollectionRefinement,
    facet: options.requestedFacet ?? defaultCollectionRefinement.facet,
  }));
  const [asked, setAsked] = useState(options.requestedFacet);
  const saved = collectionMemory.useEntry(remember)?.refinement;
  const requestedFacet = options.requestedFacet;
  useEffect(() => {
    if (remember) setAsked(requestedFacet);
    else if (requestedFacet) setLocal((old) => ({ ...old, facet: requestedFacet }));
  }, [remember, requestedFacet]);
  let state = local;
  if (remember) {
    state = { ...defaultCollectionRefinement, ...saved, ...(asked ? { facet: asked } : {}) };
    // A saved type that this collection no longer offers shows everything.
    if (options.facet && !options.facet.options.some((option) => option.value === state.facet))
      state = { ...state, facet: defaultCollectionRefinement.facet };
  }
  const change = (patch: Partial<CollectionRefinement>) => {
    if (!remember) return setLocal((old) => ({ ...old, ...patch }));
    if (patch.facet !== undefined) setAsked(undefined);
    collectionMemory.set(remember, (entry) => ({
      ...entry,
      refinement: { ...defaultCollectionRefinement, ...entry?.refinement, ...patch },
    }));
  };
  const active = Object.keys(state).some(
    (key) =>
      state[key as keyof CollectionRefinement] !==
      defaultCollectionRefinement[key as keyof CollectionRefinement],
  );
  const reset = () => change(defaultCollectionRefinement);
  const groups: CollectionFilterGroup[] = [];
  if (options.facet)
    groups.push({
      label: options.facet.label,
      value: state.facet,
      options: options.facet.options,
      onChange: (facet) => change({ facet }),
    });
  if (options.dateWindow !== false)
    groups.push({
      label: options.dateLabel ?? "Last activity",
      submenu: true,
      icon: CalendarClock,
      value: state.period,
      options: [
        { value: "all", label: "Any time", icon: CalendarRange },
        { value: "7", label: "Last 7 days", icon: CalendarDays },
        { value: "30", label: "Last 30 days", icon: CalendarDays },
      ],
      onChange: (period) => change({ period }),
    });
  groups.push({
    label: "Sort by",
    kind: "sort",
    submenu: true,
    value: state.sort,
    options: [
      { value: "default", label: options.defaultOrderLabel ?? "Default order", icon: ArrowUpDown },
      { value: "recent", label: "Newest first", icon: ArrowDownWideNarrow },
      { value: "oldest", label: "Oldest first", icon: ArrowDownNarrowWide },
      { value: "name", label: "Name A–Z", icon: ArrowDownAZ },
      { value: "name-desc", label: "Name Z–A", icon: ArrowDownZA },
    ],
    onChange: (sort) => change({ sort }),
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
