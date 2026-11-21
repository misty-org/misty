import type { ReactNode } from "react";
import { InUseMark, TagDots, type CollectionColumn, type CollectionItem, type ColumnBrowserRow } from "@misty/ui";
import { personTone } from "@/features/agents";
import { FileNameIcon, thumbnailUrl } from "@/features/files";
import { driveInUsePeople, driveSyncMark } from "../drive";
import { formatBytes, formatDate, isPictured, kindOf } from "./format";
import { itemShape, type FileItem } from "./model";

/** The grid's picture size, in pixels, as the protocol makes it. */
const THUMBNAIL_PX = 256;

/** Finder's list columns after the name: Date modified, Size and Kind, each sorted by its own value. */
export const fileColumns: CollectionColumn[] = [
  {
    key: "modified",
    label: "Date modified",
    render: (item) => item.updated,
    sortValue: (item) => item.sortValues?.modified,
  },
  {
    key: "size",
    label: "Size",
    render: (item) => String(item.metadata?.Size ?? "—"),
    sortValue: (item) => item.sortValues?.size,
  },
  {
    key: "kind",
    label: "Kind",
    render: (item) => item.category,
    sortValue: (item) => item.category,
  },
];

/** What the item is, at the glyph size. */
export const itemIcon = (item: FileItem) => <FileNameIcon name={item.name} kind={itemShape(item)} />;

/** The item's Finder tags, after its name. */
const tagMarks = (item: FileItem) => (item.tags.length ? <TagDots tags={item.tags} /> : undefined);

/** A picture of the file itself, for an image on the disk; drive files may not be on this computer yet. */
function preview(item: FileItem): ReactNode {
  if (item.source.kind !== "disk" || item.folder || !isPictured(item.name)) return undefined;
  return <img alt="" loading="lazy" src={thumbnailUrl(item.source.entry.path, item.modifiedMs, THUMBNAIL_PX)} />;
}

const sizeText = (item: FileItem) => (itemShape(item) === "folder" ? "—" : formatBytes(item.size));

/** An item as a row of the list or a card of the grid. A press goes to `onSelect`; `menu` is its actions. */
export function collectionItem(
  item: FileItem,
  options: { onOpen(item: FileItem): void; menu: ReactNode; onMenuOpen(): void; dropTarget: boolean },
): CollectionItem {
  const drive = item.source.kind === "drive" ? item.source.entry : undefined;
  const inUse = drive ? driveInUsePeople(drive, personTone) : [];
  return {
    id: item.id,
    title: item.name,
    icon: itemIcon(item),
    preview: preview(item),
    category: kindOf(item),
    updated: formatDate(item.modifiedMs),
    metadata: { Size: sizeText(item) },
    sortValues: { modified: item.modifiedMs, size: itemShape(item) === "folder" ? undefined : item.size },
    marks: tagMarks(item),
    marker: inUse.length ? <InUseMark people={inUse} /> : undefined,
    sync: drive && drive.kind === "file" ? driveSyncMark(drive) : undefined,
    dropTarget: options.dropTarget,
    menu: options.menu,
    menuLabel: `Actions for ${item.name}`,
    onMenuOpen: options.onMenuOpen,
    onOpen: () => options.onOpen(item),
    selectable: true,
  };
}

/** An item as a row of the column view. */
export function columnRow(item: FileItem, cut: boolean): ColumnBrowserRow {
  return {
    id: item.id,
    label: item.name,
    icon: itemIcon(item),
    folder: item.folder,
    dim: item.hidden || cut,
    marks: tagMarks(item),
  };
}
