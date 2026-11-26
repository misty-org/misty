import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Blocks,
  Cable,
  CircleArrowDown,
  Compass,
  LayoutGrid,
  ScrollText,
  Settings2,
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
  ProductBar,
  RowGroupStack,
  SearchField,
  Separator,
  SidePanel,
  Text,
  ToolbarDivider,
  type CollectionFilterGroup,
} from "@misty/ui";
import type { ListingKind } from "@/native/registry";
import { AllPage, KindPage, SearchPage } from "./ExploreKinds";
import { ExploreManage } from "./ExploreManage";
import { ExploreProduct } from "./ExploreProducts";
import { AppsPage } from "./ExploreApps";
import { EnginesPage } from "./ExploreEngines";
import { SpeechPage } from "./ExploreSpeech";
import { MyAppsPage } from "./ExploreUpdates";
import { useMyAppsCount } from "./explore_updates";
import { ListingList } from "./ListingList";
import { ActionButton } from "./ListingRows";
import { kindNames, useCategories, useListing, type ExploreSort } from "./explore_index";
import {
  ExploreNavContext,
  itemKey,
  pageOf,
  type BarAction,
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
    held: linkedApp
      ? [{ view: { at: "item", item: { kind: "apps", id: linkedApp } }, top: 0 }]
      : [],
    baseTop: 0,
  }));
  const searching = query.trim() !== "";
  if (stack.page !== page || stack.query !== query) setStack({ page, query, held: [], baseTop: 0 });
  const base: ExploreView = searching ? { at: "search", query } : { at: "page", page };
  const view =
    stack.page === page && stack.query === query ? (stack.held.at(-1)?.view ?? base) : base;

  const [sort, setSort] = useState<ExploreSort>("popular");
  const [category, setCategory] = useState("all");
  const [facet, setFacet] = useState("all");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [pinned, setPinned] = useState(false);
  const [bar, setBar] = useState<(Omit<BarAction, "onClick"> & { run: () => void }) | null>(null);
  const [barTitle, setBarTitle] = useState("");
  const [managing, setManaging] = useState<ExploreItem | null>(null);
  const scroller = useRef<HTMLElement>(null);
  const restore = useRef<number | null>(null);
  const mine = useMyAppsCount(spaceId);

  const goTab = useCallback(
    (next: Page) => {
      const params = new URLSearchParams(location.search);
      params.set("tab", next);
      setQuery("");
      setCategory("all");
      setFacet("all");
      setStack({ page: next, query: "", held: [], baseTop: 0 });
      setManaging(null);
      restore.current = 0;
      navigate(`${location.pathname}?${params}`, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  const nav = useMemo<ExploreNav>(() => {
    const push = (next: ExploreView) => {
      const top = scroller.current?.scrollTop ?? 0;
      setPinned(false);
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
      open: (item: ExploreItem) => push({ at: "item", item }),
      manage: (item: ExploreItem) => setManaging(item),
      closeManage: () => setManaging(null),
      back: () => {
        setPinned(false);
        setStack((current) => {
          const held = current.held.slice(0, -1);
          restore.current = held.at(-1)?.top ?? current.baseTop;
          return { ...current, held };
        });
      },
      setPinned,
      setBarAction: (action, onClick, title) => {
        setBar(action && onClick ? { ...action, run: onClick } : null);
        if (title !== undefined) setBarTitle(title);
      },
    };
  }, [goTab]);

  const viewKey = view.at === "item" ? itemKey(view.item) : JSON.stringify(view);
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
      <SearchField
        aria-label="Search Explore"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery("")}
      />
      <NavList>
        {rail.map(({ value, label, icon: Icon }) => (
          <NavRow key={value} current={!searching && page === value} onClick={() => goTab(value)}>
            <Icon />
            <OverflowFadeText>{label}</OverflowFadeText>
          </NavRow>
        ))}
      </NavList>
      <Separator />
      <NavList>
        <NavRow current={!searching && page === "mine"} onClick={() => goTab("mine")}>
          <CircleArrowDown />
          <OverflowFadeText>My apps</OverflowFadeText>
          {mine ? (
            <Text size="caption" tone="muted" className="ml-auto tabular-nums">
              {mine}
            </Text>
          ) : null}
        </NavRow>
      </NavList>
    </nav>
  );

  const barButton = bar ? (
    <ActionButton action={{ ...bar, onClick: bar.run }} size="md" label={barTitle} />
  ) : null;

  const header = (
    <ExploreBar
      view={view}
      title={barTitle}
      pinned={pinned}
      action={barButton}
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
  if (view.at === "item")
    body = <ExploreProduct key={viewKey} item={view.item} spaceId={spaceId} />;
  else if (view.at === "list")
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
    body = <SearchPage query={view.query} sort={sort} spaceId={spaceId} />;
  else if (view.page === "all") body = <AllPage spaceId={spaceId} />;
  else if (view.page === "apps") body = <AppsPage spaceId={spaceId} />;
  else if (view.page === "engines") body = <EnginesPage />;
  else if (view.page === "speech") body = <SpeechPage />;
  else if (view.page === "mine") body = <MyAppsPage spaceId={spaceId} />;
  else body = <KindPage kind={view.page} sort={sort} category={category} facet={facet} />;

  const flush = view.at === "list" && layout === "list";
  return (
    <ExploreNavContext.Provider value={nav}>
      <FramedPage
        autoSaveId="explore"
        header={header}
        end={
          managing
            ? {
                id: "explore-manage",
                label: "Resize Manage",
                width: 360,
                minWidth: 288,
                maxWidth: 540,
                content: (
                  <SidePanel
                    label="Manage"
                    name="Manage"
                    icon={Settings2}
                    onClose={() => setManaging(null)}
                  >
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-8">
                      <RowGroupStack>
                        <ExploreManage key={itemKey(managing)} item={managing} spaceId={spaceId} />
                      </RowGroupStack>
                    </div>
                  </SidePanel>
                ),
              }
            : null
        }
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
            <div className="mx-auto grid w-full max-w-6xl content-start gap-10 px-9 pt-6 pb-16">
              {body}
            </div>
          )}
        </main>
      </FramedPage>
    </ExploreNavContext.Provider>
  );
}

function ExploreBar({
  view,
  title,
  pinned,
  action,
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
  title: string;
  pinned: boolean;
  action: ReactNode;
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
  const kind: ListingKind | null =
    view.at === "list"
      ? view.kind
      : view.at === "page" && listingPages.has(view.page)
        ? (view.page as ListingKind)
        : null;
  const listing = useListing(kind ?? "skills");
  const back = <BackButton onClick={onBack} />;
  if (view.at === "item")
    return <ProductBar back={back} title={title} action={action} pinned={pinned} />;
  const sortMenu = (
    <CollectionSortMenu
      value={sort}
      options={view.at === "list" ? sorts : sorts.slice(0, 2)}
      onChange={(next) => onSort(next)}
    />
  );
  const groups: CollectionFilterGroup[] = [];
  const facetGroup = kind ? facets[kind] : undefined;
  if (facetGroup)
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
            {back}
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
  if (kind && listing)
    return (
      <FramedBar
        start={
          <Text size="meta" tone="muted">
            {`${listing.count.toLocaleString()} ${kindNames[kind].counted}`}
          </Text>
        }
      >
        {filter}
        {sortMenu}
      </FramedBar>
    );
  if (view.at === "search") return <FramedBar>{sortMenu}</FramedBar>;
  return <FramedBar>{action}</FramedBar>;
}
