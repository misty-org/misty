import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Blocks,
  Cable,
  CircleArrowDown,
  Compass,
  LayoutGrid,
  ScrollText,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  appIcons,
  BackButton,
  CollectionFilterMenu,
  CollectionSortMenu,
  CollectionViewToggle,
  FramedBar,
  FramedPage,
  NavList,
  NavRow,
  OverflowFadeText,
  SearchField,
  Separator,
  Text,
  ToolbarDivider,
  type CollectionFilterGroup,
} from "@misty/ui";
import type { ListingKind } from "@/native/registry";
import { AllPage, KindPage, SearchPage } from "./ExploreKinds";
import { ExploreSheet } from "./ExploreProducts";
import { AppsPage } from "./ExploreApps";
import { EnginesPage } from "./ExploreEngines";
import { SpeechPage } from "./ExploreSpeech";
import { InstalledPage } from "./ExploreUpdates";
import { useInstalledCount } from "./explore_updates";
import { ListingList } from "./ListingList";
import { kindNames, useCategories, useListing, type ExploreSort } from "./explore_index";
import {
  ExploreNavContext,
  itemKey,
  pageOf,
  type ExploreItem,
  type ExploreNav,
  type ExplorePage as Page,
  type ExploreView,
} from "./explore_view";

export type { ExplorePage as MarketTab } from "./explore_view";

const rail: { value: Page; label: string; icon: LucideIcon }[] = [
  { value: "all", label: "All", icon: Compass },
  { value: "apps", label: "Apps", icon: LayoutGrid },
  { value: "templates", label: "Templates", icon: Users },
  { value: "skills", label: "Skills", icon: ScrollText },
  { value: "plugins", label: "Plugins", icon: Blocks },
  { value: "mcps", label: "MCP", icon: Cable },
  { value: "engines", label: "Engines", icon: appIcons.engines },
  { value: "speech", label: "Speech", icon: appIcons.speech },
];

const sorts = [
  { value: "popular", label: "Most popular", icon: ArrowDownWideNarrow },
  { value: "name", label: "Name", icon: ArrowDownAZ },
  { value: "maker", label: "Maker", icon: UserRound },
] as const;

const facets: Partial<
  Record<ListingKind, { label: string; options: { value: string; label: string }[] }>
> = {
  plugins: {
    label: "Adds",
    options: [
      { value: "all", label: "Anything" },
      { value: "skills", label: "Skills" },
      { value: "agents", label: "Agents" },
      { value: "commands", label: "Commands" },
      { value: "hooks", label: "Hooks" },
      { value: "mcp", label: "An MCP server" },
    ],
  },
  mcps: {
    label: "Connects",
    options: [
      { value: "all", label: "Any way" },
      { value: "remote", label: "Hosted, you sign in" },
      { value: "package", label: "Runs on this computer" },
    ],
  },
};

const listingPages = new Set<string>(["templates", "skills", "plugins", "mcps"]);
const searchPages = new Set<string>(["all", "apps", ...listingPages]);

const listingOf = (page: Page): ListingKind | null =>
  listingPages.has(page) ? (page as ListingKind) : null;

interface Held {
  view: ExploreView;
  top: number;
}

interface Stack {
  page: Page;
  query: string;
  held: Held[];
  baseTop: number;
}

interface ExplorePageProps {
  spaceId: string;
}

export function ExplorePage({ spaceId }: ExplorePageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const page = pageOf(params.get("tab"));
  const linkedApp = params.get("app");
  const [query, setQuery] = useState("");
  const [stack, setStack] = useState<Stack>(() => ({
    page,
    query: "",
    held: [],
    baseTop: 0,
  }));
  const [sheet, setSheet] = useState<ExploreItem | null>(() =>
    linkedApp ? { kind: "apps", id: linkedApp } : null,
  );
  const searching = query.trim() !== "" && searchPages.has(page);
  if (stack.page !== page || stack.query !== query) setStack({ page, query, held: [], baseTop: 0 });
  const base: ExploreView = searching
    ? { at: "search", query, within: page }
    : { at: "page", page };
  const view =
    stack.page === page && stack.query === query ? (stack.held.at(-1)?.view ?? base) : base;

  const [sort, setSort] = useState<ExploreSort>("popular");
  const [category, setCategory] = useState("all");
  const [facet, setFacet] = useState("all");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const scroller = useRef<HTMLElement>(null);
  const restore = useRef<number | null>(null);
  const installed = useInstalledCount(spaceId);

  const goTab = useCallback(
    (next: Page) => {
      const params = new URLSearchParams(location.search);
      params.set("tab", next);
      params.delete("app");
      setQuery("");
      setCategory("all");
      setFacet("all");
      setStack({ page: next, query: "", held: [], baseTop: 0 });
      restore.current = 0;
      navigate(`${location.pathname}?${params}`, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const nav = useMemo<ExploreNav>(() => {
    const push = (next: ExploreView) => {
      const top = scroller.current?.scrollTop ?? 0;
      setStack((current) => {
        const held = [...current.held];
        const last = held.at(-1);
        if (last) held[held.length - 1] = { ...last, top };
        return {
          ...current,
          held: [...held, { view: next, top: 0 }],
          baseTop: last ? current.baseTop : top,
        };
      });
      restore.current = 0;
    };
    return {
      go: (next) => {
        if (next.at === "page") goTab(next.page);
        else push(next);
      },
      open: (item: ExploreItem) => setSheet(item),
      close: () => setSheet(null),
      back: () => {
        setStack((current) => {
          const held = current.held.slice(0, -1);
          restore.current = held.at(-1)?.top ?? current.baseTop;
          return { ...current, held };
        });
      },
    };
  }, [goTab]);

  const viewKey = JSON.stringify(view);
  useLayoutEffect(() => {
    if (restore.current === null || !scroller.current) return;
    scroller.current.scrollTop = restore.current;
    restore.current = null;
  }, [viewKey]);

  const railColumn = (
    <nav
      aria-label="Explore"
      className="grid size-full content-start gap-3 overflow-y-auto px-3 py-4"
    >
      <NavList>
        {rail.map(({ value, label, icon: Icon }) => (
          <NavRow key={value} current={page === value} onClick={() => goTab(value)}>
            <Icon />
            <OverflowFadeText>{label}</OverflowFadeText>
          </NavRow>
        ))}
      </NavList>
      <Separator />
      <NavList>
        <NavRow current={page === "mine"} onClick={() => goTab("mine")}>
          <CircleArrowDown />
          <OverflowFadeText>Installed</OverflowFadeText>
          {installed ? (
            <Text size="caption" tone="muted" className="ml-auto tabular-nums">
              {installed}
            </Text>
          ) : null}
        </NavRow>
      </NavList>
    </nav>
  );

  const header = (
    <ExploreBar
      view={view}
      page={page}
      query={query}
      onQuery={setQuery}
      sort={sort}
      onSort={setSort}
      category={category}
      onCategory={setCategory}
      facet={facet}
      onFacet={setFacet}
      layout={layout}
      onLayout={setLayout}
      onBack={nav.back}
    />
  );

  let body: ReactNode;
  if (view.at === "list")
    body = (
      <ListingList
        key={viewKey}
        kind={view.kind}
        category={view.category}
        query={view.query}
        sort={sort}
        facet={facet}
        layout={layout}
      />
    );
  else if (view.at === "search")
    body = (
      <SearchPage
        query={view.query}
        sort={sort}
        spaceId={spaceId}
        within={view.within === "apps" ? "apps" : (listingOf(view.within) ?? undefined)}
      />
    );
  else if (view.page === "all") body = <AllPage spaceId={spaceId} />;
  else if (view.page === "apps") body = <AppsPage spaceId={spaceId} />;
  else if (view.page === "engines") body = <EnginesPage />;
  else if (view.page === "speech") body = <SpeechPage spaceId={spaceId} />;
  else if (view.page === "mine") body = <InstalledPage spaceId={spaceId} />;
  else body = <KindPage kind={view.page} sort={sort} category={category} facet={facet} />;

  const flush = view.at === "list" && layout === "list";
  return (
    <ExploreNavContext.Provider value={nav}>
      <FramedPage
        autoSaveId="explore"
        header={header}
        start={{
          id: "explore-rail",
          label: "Resize the rail",
          width: 180,
          minWidth: 144,
          maxWidth: 300,
          keep: true,
          content: railColumn,
        }}
      >
        <main ref={scroller} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {flush ? (
            body
          ) : (
            <div className="mx-auto grid w-full max-w-6xl content-start gap-9 px-9 pt-6 pb-16">
              {body}
            </div>
          )}
        </main>
      </FramedPage>
      {sheet ? (
        <ExploreSheet
          key={itemKey(sheet)}
          item={sheet}
          spaceId={spaceId}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </ExploreNavContext.Provider>
  );
}

function ExploreBar({
  view,
  page,
  query,
  onQuery,
  sort,
  onSort,
  category,
  onCategory,
  facet,
  onFacet,
  layout,
  onLayout,
  onBack,
}: {
  view: ExploreView;
  page: Page;
  query: string;
  onQuery: (query: string) => void;
  sort: ExploreSort;
  onSort: (sort: ExploreSort) => void;
  category: string;
  onCategory: (category: string) => void;
  facet: string;
  onFacet: (facet: string) => void;
  layout: "list" | "grid";
  onLayout: (layout: "list" | "grid") => void;
  onBack: () => void;
}) {
  const categories = useCategories();
  const kind: ListingKind | null = view.at === "list" ? view.kind : listingOf(page);
  const listing = useListing(kind ?? "skills");
  const sortMenu = (
    <CollectionSortMenu
      value={sort}
      options={view.at === "list" ? sorts : sorts.slice(0, 2)}
      onChange={(next) => onSort(next)}
    />
  );
  const groups: CollectionFilterGroup[] = [];
  const facetGroup = kind ? facets[kind] : undefined;
  if (facetGroup && view.at !== "search")
    groups.push({
      label: facetGroup.label,
      value: facet,
      options: facetGroup.options,
      onChange: onFacet,
    });
  if (view.at === "page" && kind && listing)
    groups.push({
      label: "Category",
      value: category,
      options: [
        { value: "all", label: "Every category" },
        ...categories
          .filter((one) => listing.categories[one.id])
          .map((one) => ({ value: one.id, label: one.name })),
      ],
      onChange: onCategory,
    });
  const filter = groups.length ? (
    <CollectionFilterMenu
      label="Filter"
      groups={groups}
      active={facet !== "all" || category !== "all"}
      onReset={() => {
        onFacet("all");
        onCategory("all");
      }}
    />
  ) : null;
  if (view.at === "list") {
    const name = view.category
      ? (categories.find((one) => one.id === view.category)?.name ?? view.category)
      : `“${view.query ?? ""}”`;
    const count = view.category ? listing?.categories[view.category]?.count : undefined;
    return (
      <FramedBar
        start={
          <>
            <BackButton onClick={onBack} />
            <Text size="control" tone="bright" weight="semibold">
              {name}
            </Text>
            <Text size="meta" tone="muted">
              {count !== undefined
                ? `${count.toLocaleString()} ${kindNames[view.kind].counted}`
                : kindNames[view.kind].many}
            </Text>
          </>
        }
      >
        {filter}
        {sortMenu}
        <ToolbarDivider />
        <CollectionViewToggle value={layout} onChange={onLayout} />
      </FramedBar>
    );
  }
  if (!searchPages.has(page)) return <FramedBar />;
  const placeholder =
    page === "all"
      ? "Search apps, templates, skills and plugins"
      : page === "apps"
        ? "Search apps"
        : kind && listing
          ? `Search ${listing.count.toLocaleString()} ${kindNames[kind].counted}`
          : `Search ${kind ? kindNames[kind].counted : ""}`;
  return (
    <FramedBar
      start={
        <SearchField
          aria-label={
            page === "all"
              ? "Search Explore"
              : `Search ${page === "apps" ? "apps" : kind ? kindNames[kind].counted : ""}`
          }
          placeholder={placeholder}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onClear={() => onQuery("")}
        />
      }
    >
      {view.at === "search" ? (
        page === "apps" ? null : (
          sortMenu
        )
      ) : kind ? (
        <>
          {filter}
          {sortMenu}
        </>
      ) : null}
    </FramedBar>
  );
}
