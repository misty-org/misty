import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ColumnBrowser, type ColumnBrowserColumn } from "@misty/ui";
import { columnRow } from "./FileItems";
import { foldersBetween, placeInside, placeKey, type FileItem, type FilesPlace } from "./model";
import { useColumnListings } from "./use_column_listings";

function chain(root: FilesPlace, place: FilesPlace): FilesPlace[] {
  if (place.kind === "disk")
    return foldersBetween(root.kind === "disk" ? root.path : place.path, place.path).map(
      (path) => ({ kind: "disk", path }),
    );
  if (place.kind === "project")
    return foldersBetween(place.root, place.path).map((path) => ({
      kind: "project",
      root: place.root,
      path,
    }));
  if (place.kind === "space-drive") {
    const parts = place.path.split("/").filter(Boolean);
    return ["/", ...parts.map((_, index) => `/${parts.slice(0, index + 1).join("/")}`)].map(
      (path) => ({
        kind: "space-drive",
        spaceId: place.spaceId,
        path,
      }),
    );
  }
  return [place];
}

export function ColumnsView({
  root,
  place,
  hidden,
  revision,
  selected,
  cut,
  preview,
  onPick,
  onOpen,
  menu,
  onDrop,
}: {
  root: FilesPlace;
  place: FilesPlace;
  hidden: boolean;
  revision: number;
  selected: readonly string[];
  cut: ReadonlySet<string>;
  preview?: ReactNode;
  onPick(folder: FilesPlace, id: string, event: MouseEvent | KeyboardEvent, order: string[]): void;
  onOpen(item: FileItem): void;
  menu(item: FileItem, folder: FilesPlace): ReactNode;
  onDrop(folder: FilesPlace, items: FileItem[], copy: boolean): void;
}) {
  const ancestors = chain(root, place);
  const listings = useColumnListings(ancestors, hidden, revision);
  const here = listings[listings.length - 1]?.items ?? [];
  const picked = selected.length === 1 ? here.find((item) => item.id === selected[0]) : undefined;
  const inside = picked ? placeInside(picked, place) : undefined;
  const places = inside ? [...ancestors, inside] : ancestors;
  const extra = useColumnListings(inside ? [inside] : [], hidden, revision);
  const all = inside ? [...listings, ...extra] : listings;

  const byId = new Map<string, { item: FileItem; folder: FilesPlace }>();
  all.forEach((listing, index) => {
    for (const item of listing.items ?? []) byId.set(item.id, { item, folder: places[index] });
  });

  const columns: ColumnBrowserColumn[] = places.map((folder, index) => {
    const listing = all[index];
    const next = places[index + 1];
    const items = listing?.items ?? null;
    const open =
      next && items
        ? items.find((item) => placeKey(placeInside(item, folder) ?? folder) === placeKey(next))
        : undefined;
    return {
      id: placeKey(folder),
      rows: items ? items.map((item) => columnRow(item, cut.has(item.id))) : null,
      error: listing?.error,
      selected: index === ancestors.length - 1 ? selected : open ? [open.id] : [],
    };
  });

  const folderOf = (id: string): FilesPlace | undefined => {
    const column = places.find((folder) => placeKey(folder) === id);
    if (column) return column;
    const row = byId.get(id);
    return row ? placeInside(row.item, row.folder) : undefined;
  };

  return (
    <ColumnBrowser
      label="Columns"
      className="min-h-0 flex-1"
      columns={columns}
      onSelect={(column, id, event) => {
        const order = (all[column]?.items ?? []).map((item) => item.id);
        onPick(places[column], id, event, order);
      }}
      onOpen={(_column, id) => {
        const row = byId.get(id);
        if (row) onOpen(row.item);
      }}
      menu={(column, id) => {
        const row = byId.get(id);
        return row ? menu(row.item, places[column]) : null;
      }}
      preview={preview}
      drag={{
        canDrop: (target) => folderOf(target) !== undefined,
        onDrop: (target, ids, copy) => {
          const folder = target === null ? places[places.length - 1] : folderOf(target);
          const items = ids.flatMap((id) => byId.get(id)?.item ?? []);
          if (folder && items.length) onDrop(folder, items, copy);
        },
      }}
    />
  );
}
