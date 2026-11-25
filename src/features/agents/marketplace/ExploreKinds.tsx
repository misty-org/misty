import { RefreshCw } from "lucide-react";
import { EmptyState, ErrorState, ShelfSkeleton } from "@misty/ui";
import {
  listingKinds,
  type EntryOf,
  type ListingEntry,
  type ListingKind,
  type McpEntry,
  type PluginEntry,
} from "@/native/registry";
import { AppsShelf, FeaturedApps } from "./ExploreApps";
import { exploreApps } from "./explore_apps";
import {
  failureText,
  kindNames,
  sorted,
  useCategories,
  useListingSearch,
  useTopShard,
  wordsMatch,
  type ExploreSort,
} from "./explore_index";
import { useExploreNav } from "./explore_view";
import { ListingShelf } from "./ListingRows";

export const SHELF = 6;

export function facetMatches(kind: ListingKind, entry: ListingEntry, facet: string) {
  if (facet === "all") return true;
  if (kind === "plugins") {
    const adds = (entry as PluginEntry).includes;
    if (!adds) return false;
    if (facet === "hooks") return adds.hooks;
    if (facet === "mcp") return adds.mcp;
    const count = adds[facet as "skills" | "agents" | "commands"];
    return typeof count === "number" && count > 0;
  }
  if (kind === "mcps") {
    const server = entry as McpEntry;
    return facet === "remote" ? Boolean(server.remote) : Boolean(server.package);
  }
  return true;
}

function KindFailed({
  kind,
  error,
  retry,
}: {
  kind: ListingKind;
  error: unknown;
  retry: () => void;
}) {
  return (
    <ErrorState
      inline
      title={`${kindNames[kind].many} couldn't load`}
      line={failureText(error, "Misty's registry couldn't be read.")}
      action={{ label: "Try again", icon: RefreshCw, variant: "secondary", onClick: retry }}
    />
  );
}

function TopShelf<K extends ListingKind>({ kind, title }: { kind: K; title: string }) {
  const nav = useExploreNav();
  const top = useTopShard(kind);
  if (!top.data)
    return top.error && !top.loading ? (
      <KindFailed kind={kind} error={top.error} retry={() => void top.reload()} />
    ) : (
      <ShelfSkeleton label={title} />
    );
  return (
    <ListingShelf
      title={title}
      kind={kind}
      items={sorted(top.data.items as EntryOf<K>[], "popular").slice(0, SHELF)}
      onSeeAll={() => nav.go({ at: "page", page: kind })}
    />
  );
}

export function AllPage({ spaceId }: { spaceId: string }) {
  const nav = useExploreNav();
  return (
    <>
      <FeaturedApps spaceId={spaceId} />
      <AppsShelf
        spaceId={spaceId}
        limit={SHELF}
        onSeeAll={() => nav.go({ at: "page", page: "apps" })}
      />
      <TopShelf kind="templates" title="Agent templates" />
      <TopShelf kind="skills" title="Popular skills" />
      <TopShelf kind="plugins" title="Plugins" />
      <TopShelf kind="mcps" title="MCP servers" />
    </>
  );
}

export function KindPage({
  kind,
  sort,
  category,
  facet,
}: {
  kind: ListingKind;
  sort: ExploreSort;
  category: string;
  facet: string;
}) {
  const nav = useExploreNav();
  const categories = useCategories();
  const top = useTopShard(kind);
  if (!top.data)
    return top.error && !top.loading ? (
      <KindFailed kind={kind} error={top.error} retry={() => void top.reload()} />
    ) : (
      <>
        <ShelfSkeleton label={kindNames[kind].many} />
        <ShelfSkeleton label={kindNames[kind].many} />
      </>
    );
  const shelves = categories
    .filter((one) => category === "all" || one.id === category)
    .map((one) => ({
      category: one,
      items: sorted(
        (top.data?.items ?? []).filter(
          (entry) => entry.category === one.id && facetMatches(kind, entry, facet),
        ),
        sort,
      ).slice(0, SHELF),
    }))
    .filter((shelf) => shelf.items.length);
  if (!shelves.length)
    return (
      <EmptyState
        inline
        title="Nothing matches these filters"
        line="Reset the filters to see more."
      />
    );
  return (
    <>
      {shelves.map(({ category: one, items }) => (
        <ListingShelf
          key={one.id}
          title={one.name}
          kind={kind}
          items={items}
          onSeeAll={() => nav.go({ at: "list", kind, category: one.id })}
        />
      ))}
    </>
  );
}

export function SearchPage({
  query,
  sort,
  spaceId,
}: {
  query: string;
  sort: ExploreSort;
  spaceId: string;
}) {
  const nav = useExploreNav();
  const { term, hits, counts, error, retry } = useListingSearch(query);
  if (error)
    return (
      <ErrorState
        inline
        title="Explore couldn't search"
        line={error}
        action={{ label: "Try again", icon: RefreshCw, variant: "secondary", onClick: retry }}
      />
    );
  const apps = (
    <AppsShelf spaceId={spaceId} query={term} limit={SHELF} quiet />
  );
  if (!hits)
    return (
      <>
        {apps}
        <ShelfSkeleton label="Search results" />
      </>
    );
  const found = listingKinds.filter((kind) => hits[kind].length);
  return (
    <>
      {apps}
      {found.map((kind) => (
        <ListingShelf
          key={kind}
          title={kindNames[kind].many}
          kind={kind}
          items={
            sorted(hits[kind] as ListingEntry[], sort).slice(0, SHELF) as EntryOf<typeof kind>[]
          }
          onSeeAll={
            (counts?.[kind] ?? 0) > SHELF
              ? () => nav.go({ at: "list", kind, category: null, query: term })
              : undefined
          }
        />
      ))}
      {!found.length ? <SearchEmpty spaceId={spaceId} query={term} /> : null}
    </>
  );
}

function SearchEmpty({ spaceId, query }: { spaceId: string; query: string }) {
  const { appsMatching } = useAppsMatching(spaceId);
  if (appsMatching(query)) return null;
  return <EmptyState inline title="No results" line={`Nothing in Explore matches “${query}”.`} />;
}

function useAppsMatching(spaceId: string) {
  const apps = exploreApps().useExploreInstalledApps(spaceId);
  return {
    appsMatching: (query: string) =>
      apps.listed.some((app) => wordsMatch(query, app.name, app.description, app.maker)),
  };
}
