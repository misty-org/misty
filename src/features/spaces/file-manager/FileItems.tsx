import { useEffect, useRef, useState, type ReactNode } from "react";
import { InUseMark, TagDots, type CollectionColumn, type CollectionItem, type ColumnBrowserRow } from "@misty/ui";
import { personTone } from "@/features/agents";
import { driveThumbnailUrl, FileNameIcon, thumbnailUrl } from "@/features/files";
import { driveInUsePeople, driveSyncMark } from "../drive";
import { formatBytes, formatDate, isPictured, kindOf } from "./format";
import { itemShape, type FileItem } from "./model";
import { thumbnailState, wantThumbnail } from "./thumbnails";

/** The grid's picture size, in pixels, as the protocol makes it. */
const THUMBNAIL_PX = 256;

/** Kura's list columns after the name: Modified, Size and Kind, each sorted by its own value. */
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

/** What the item is, at the glyph size. */
export const itemIcon = (item: FileItem) => <FileNameIcon name={item.name} kind={itemShape(item)} />;

/** The item's Finder tags, after its name. */
const tagMarks = (item: FileItem) => (item.tags.length ? <TagDots tags={item.tags} /> : undefined);

/** Whether this computer holds a drive file's content, so a picture of it can be drawn without
 * downloading it. */
export const driveHasContent = (state: string) => state !== "online" && state !== "downloading";

/** Where the grid's picture of the item comes from: an image on the disk, or one in a Space's drive
 * that this computer already holds (a file only on the server shows its icon until it is opened). */
export function thumbnailFor(item: FileItem): string | undefined {
  if (item.folder || !isPictured(item.name)) return undefined;
  const from = item.source;
  if (from.kind === "disk") return thumbnailUrl(from.entry.path, item.modifiedMs, THUMBNAIL_PX);
  if (from.kind === "drive" && from.entry.kind === "file" && driveHasContent(from.entry.state))
    return driveThumbnailUrl(from.entry.space_id, from.entry.path, item.modifiedMs, THUMBNAIL_PX);
  return undefined;
}

/** A grid picture that waits its turn in the thumbnail queue once it comes near the screen, and
 * shows at once when it was fetched before. One that couldn't be made stays empty. */
function Thumbnail({ url }: { url: string }) {
  const picture = useRef<HTMLImageElement>(null);
  const [state, setState] = useState(() => thumbnailState(url));
  useEffect(() => {
    const now = thumbnailState(url);
    setState(now);
    const shown = picture.current;
    if (now !== "waiting" || !shown) return;
    let drop: (() => void) | undefined;
    const near = new IntersectionObserver(
      (seen) => {
        if (drop || !seen.some((entry) => entry.isIntersecting)) return;
        drop = wantThumbnail(url, setState);
      },
      { rootMargin: "200px" },
    );
    near.observe(shown);
    return () => {
      near.disconnect();
      drop?.();
    };
  }, [url]);
  return <img ref={picture} alt="" src={state === "ready" ? url : undefined} />;
}

/** A picture of the file itself, where the grid shows one. */
function preview(item: FileItem): ReactNode {
  const url = thumbnailFor(item);
  return url ? <Thumbnail url={url} /> : undefined;
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
