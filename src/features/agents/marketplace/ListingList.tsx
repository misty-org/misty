import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import {
  CollectionItems,
  CollectionSkeleton,
  EmptyState,
  ErrorState,
  type CollectionColumn,
  type CollectionItem,
} from "@misty/ui";
import type { EntryOf, ListingEntry, ListingKind } from "@/native/registry";
import { facetMatches } from "./ExploreKinds";
import {
  failureText,
  kindNames,
  rankText,
  sorted,
  useCategoryShard,
  useListingSearch,
  type ExploreSort,
} from "./explore_index";
import { useExploreNav, type ExploreItem, type ListingItem } from "./explore_view";
import { ActionButton, ListingLogo, useListingAction } from "./ListingRows";

function RowAction({ kind, entry }: { kind: ListingKind; entry: ListingEntry }) {
  const { action } = useListingAction({ kind, entry } as ListingItem);
  return <ActionButton action={action} />;
}

export function ListingList({
  kind,
  category,
  query,
  sort,
  facet,
  layout,
}: {
  kind: ListingKind;
  category: string | null;
  query?: string;
  sort: ExploreSort;
  facet: string;
  layout: "list" | "grid";
}) {
  const nav = useExploreNav();
  const shard = useCategoryShard(kind, category);
  const search = useListingSearch(category ? "" : (query ?? ""), { kind, limit: 2000 });
  const source: ListingEntry[] | null = category
    ? ((shard.data?.items as ListingEntry[] | undefined) ?? null)
    : ((search.hits?.[kind] as ListingEntry[] | undefined) ?? null);
  const failed = category
    ? shard.error && !shard.loading
      ? shard.error
      : null
    : search.error || null;

  const byId = useMemo(
    () => new Map((source ?? []).map((entry) => [entry.id, entry] as const)),
    [source],
  );
  const items = useMemo<CollectionItem[]>(
    () =>
      sorted(
        (source ?? []).filter((entry) => facetMatches(kind, entry, facet)),
        sort,
      ).map((entry) => ({
        id: entry.id,
        title: entry.name,
        icon: <ListingLogo entry={entry} />,
        category: entry.maker,
        updated: rankText(entry.rank),
        metadata: { about: entry.description },
        sortValues: { maker: entry.maker, rank: entry.rank ?? 0 },
        onOpen: () => nav.open({ kind, entry } as ExploreItem),
      })),
    [source, kind, facet, sort, nav],
  );
  const columns = useMemo<CollectionColumn[]>(
    () => [
      {
        key: "maker",
        label: "Maker",
        render: (item) => item.category,
        sortValue: (item) => item.sortValues?.maker,
      },
      {
        key: "rank",
        label: "Stars",
        render: (item) => item.updated,
        sortValue: (item) => item.sortValues?.rank,
      },
      {
        key: "action",
        label: "",
        render: (item) => {
          const entry = byId.get(item.id);
          return entry ? <RowAction kind={kind} entry={entry as EntryOf<typeof kind>} /> : null;
        },
        sortValue: () => undefined,
      },
    ],
    [byId, kind],
  );

  if (failed)
    return (
      <div className="grid p-9">
        <ErrorState
          inline
          title={`${kindNames[kind].many} couldn't load`}
          line={failureText(failed, "Misty's registry couldn't be read.")}
          action={{
            label: "Try again",
            icon: RefreshCw,
            variant: "secondary",
            onClick: () => (category ? void shard.reload() : search.retry()),
          }}
        />
      </div>
    );
  if (!source)
    return <CollectionSkeleton label={kindNames[kind].many} view={layout} icons cards="compact" />;
  if (!items.length)
    return (
      <div className="grid p-9">
        <EmptyState
          inline
          title="Nothing matches these filters"
          line="Reset the filters to see more."
        />
      </div>
    );
  return (
    <CollectionItems
      items={items}
      view={layout}
      columns={columns}
      listIcons
      gridLayout="compact"
      cardTitleLines={2}
      showLastActivity={false}
      remember={`explore-list:${kind}`}
    />
  );
}
