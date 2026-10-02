import { useContext, useEffect, useState } from "react";
import { CollectionItemsGrid } from "./CollectionCards";
import { CollectionColumnsContext } from "./CollectionColumns";
import { CollectionItemsTable, type CollectionSort } from "./CollectionItemsTable";
import {
  compareCollectionValues,
  type CollectionColumn,
  type CollectionItem,
} from "./collectionItemTypes";

export function CollectionItems({
  items,
  categoryLabel = "Area",
  view = "list",
  creatorLabel = "Created by",
  columns,
  fields = [],
  columnSetId,
  showLastActivity = true,
  sortResetKey = "",
}: {
  items: CollectionItem[];
  categoryLabel?: string;
  view?: "list" | "grid";
  creatorLabel?: string;
  columns?: CollectionColumn[];
  /** Metadata labels, in display order; also defines columns when there are no rows. */
  fields?: string[];
  columnSetId?: string;
  showLastActivity?: boolean;
  /** Reset a header sort when the owning surface changes its menu ordering or section. */
  sortResetKey?: string;
}) {
  const hasActions = items.some((item) => item.actions);
  const hasCreators = items.some((item) => item.creator !== undefined);
  const scope = [
    columnSetId ?? "",
    fields.join(","),
    categoryLabel,
    creatorLabel,
    columns?.map((column) => column.key).join(",") ?? "",
    sortResetKey,
  ].join(":");
  const [sort, setSort] = useState<{ key: string; descending: boolean; scope: string } | null>(
    null,
  );
  const activeSort = sort?.scope === scope ? sort : null;
  if (sort && sort.scope !== scope) setSort(null);
  const baseColumns: CollectionColumn[] = columns ?? [
    {
      key: "category",
      label: categoryLabel,
      render: (item) => item.category,
      sortValue: (item) => item.sortValues?.category ?? item.category,
    },
    ...(hasCreators
      ? [
          {
            key: "creator",
            label: creatorLabel,
            render: (item: CollectionItem) => (
              <span title={item.creatorDescription} className="block max-w-48 truncate">
                {item.creator || "Unknown"}
              </span>
            ),
            sortValue: (item: CollectionItem) => item.creator,
          },
        ]
      : []),
    {
      key: "updated",
      label: "Last activity",
      render: (item) => <span className="text-xs">{item.updated}</span>,
      sortValue: (item) => (item.updatedAt ? Date.parse(item.updatedAt) : undefined),
    },
  ];
  const extraColumns: CollectionColumn[] = fields.map((label) => ({
    key: `metadata:${label}`,
    label,
    render: (item) => (
      <span className="block max-w-48 truncate" title={String(item.metadata?.[label] ?? "")}>
        {item.metadata?.[label] ?? "—"}
      </span>
    ),
    sortValue: (item) => item.sortValues?.[label] ?? item.metadata?.[label],
  }));
  const metadataColumns = [
    ...baseColumns.filter((column) => column.key !== "updated"),
    ...extraColumns,
    ...baseColumns.filter((column) => column.key === "updated" && showLastActivity),
  ];
  const allColumns: CollectionColumn[] = [
    { key: "name", label: "Name", render: (item) => item.title, sortValue: (item) => item.title },
    ...metadataColumns,
  ];
  const columnContext = useContext(CollectionColumnsContext);
  const register = columnContext?.register;
  const schemaKey = JSON.stringify(allColumns.map(({ key, label }) => ({ key, label })));
  const schemaId = columnSetId ?? schemaKey;
  useEffect(() => {
    if (view !== "list") return;
    register?.({ id: schemaId, columns: JSON.parse(schemaKey) });
    return () => register?.(null);
  }, [register, schemaId, schemaKey, view]);
  const hidden = columnContext?.hidden[schemaId] ?? [];
  if (activeSort && hidden.includes(activeSort.key)) setSort(null);
  const visibleColumns = allColumns.filter((column) => !hidden.includes(column.key));
  const visibleMetadataColumns = metadataColumns.filter((column) => !hidden.includes(column.key));
  const selectedColumn = visibleColumns.find((column) => column.key === activeSort?.key);
  const orderedItems =
    activeSort && selectedColumn
      ? [...items].sort((a, b) =>
          compareCollectionValues(
            selectedColumn.sortValue(a),
            selectedColumn.sortValue(b),
            activeSort.descending,
          ),
        )
      : items;
  if (view === "grid")
    return (
      <CollectionItemsGrid
        items={orderedItems}
        hasCreators={hasCreators}
        creatorLabel={creatorLabel}
      />
    );
  return (
    <CollectionItemsTable
      items={orderedItems}
      columns={visibleColumns}
      metadataColumns={visibleMetadataColumns}
      hasActions={hasActions}
      sort={activeSort}
      onSort={(next: CollectionSort | null) => setSort(next && { ...next, scope })}
    />
  );
}
