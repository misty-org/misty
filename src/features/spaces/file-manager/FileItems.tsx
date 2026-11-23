import { useState, type ReactNode } from "react";
import {
  InUseMark,
  TagDots,
  type CollectionColumn,
  type CollectionItem,
  type ColumnBrowserRow,
} from "@misty/ui";
import { personTone } from "@/features/agents";
import { driveThumbnailUrl, FileNameIcon, thumbnailUrl } from "@/features/files";
import { driveInUsePeople, driveSyncMark } from "../drive";
import { formatBytes, formatDate, isPictured, kindOf } from "./format";
import { itemShape, type FileItem } from "./model";

const THUMBNAIL_PX = 256;

export const fileColumns: CollectionColumn[] = [
  {
    key: "modified",
    label: "Modified",
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

export const itemIcon = (item: FileItem) => (
  <FileNameIcon name={item.name} kind={itemShape(item)} />
);

const tagMarks = (item: FileItem) => (item.tags.length ? <TagDots tags={item.tags} /> : undefined);

export const driveHasContent = (state: string) => state !== "online" && state !== "downloading";

export function thumbnailFor(item: FileItem): string | undefined {
  if (item.folder || !isPictured(item.name)) return undefined;
  const from = item.source;
  if (from.kind === "disk") return thumbnailUrl(from.entry.path, item.modifiedMs, THUMBNAIL_PX);
  if (from.kind === "drive" && from.entry.kind === "file" && driveHasContent(from.entry.state))
    return driveThumbnailUrl(from.entry.space_id, from.entry.path, item.modifiedMs, THUMBNAIL_PX);
  return undefined;
}

function Thumbnail({ url, fallback }: { url: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === url) return fallback;
  return <img alt="" src={url} loading="lazy" decoding="async" onError={() => setFailed(url)} />;
}

function preview(item: FileItem): ReactNode {
  const url = thumbnailFor(item);
  return url ? <Thumbnail url={url} fallback={itemIcon(item)} /> : undefined;
}

const sizeText = (item: FileItem) => (itemShape(item) === "folder" ? "—" : formatBytes(item.size));

export function collectionItem(
  item: FileItem,
  options: {
    onOpen(item: FileItem): void;
    menu: () => ReactNode;
    onMenuOpen(): void;
    dropTarget: boolean;
  },
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
    sortValues: {
      modified: item.modifiedMs,
      size: itemShape(item) === "folder" ? undefined : item.size,
    },
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
