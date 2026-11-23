// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { FileSearch, Files } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  CopyButton,
  EmptyState,
  ErrorState,
  ListRowSkeleton,
  PaneLoading,
  PropertyList,
  Separator,
  Surface,
  TagDots,
  Text,
  TreeRow,
  type PropertyListItem,
} from "@misty/ui";
import { disk, type FileInfo, type FolderSize } from "@/features/files";
import { FilePreview } from "./FilePreview";
import { countText, formatBytes, formatDate, kindOf, messageOf } from "./format";
import { itemIcon } from "./FileItems";
import { localPath, parentOf, placeInside, type FileItem, type FilesPlace } from "./model";
import { sourceOf } from "./sources";
import { useListing } from "./store/listing_cache";
import { newOpId } from "./use_operations";

const SETTLE_MS = 150;

function useSettled() {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  return settled;
}

type Loaded =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; info: FileInfo };

function useInfo(path: string | undefined, folder: boolean, settled: boolean) {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const [size, setSize] = useState<FolderSize | null>(null);
  useEffect(() => {
    if (!path || !settled) return;
    let live = true;
    let sizing = false;
    const opId = newOpId();
    setState({ status: "loading" });
    setSize(null);
    void disk.info(path).then(
      (info) => live && setState({ status: "ready", info }),
      (cause) =>
        live &&
        setState({ status: "failed", message: messageOf(cause, "Its details couldn't be read.") }),
    );
    if (folder) {
      sizing = true;
      void disk
        .folderSize(path, opId)
        .then(
          (next) => live && setSize(next),
          () => undefined,
        )
        .finally(() => {
          sizing = false;
        });
    }
    return () => {
      live = false;
      if (sizing) void disk.cancel(opId).catch(() => undefined);
    };
  }, [path, folder, settled]);
  return { state, size };
}

function Checksum({ path }: { path: string }) {
  const [sum, setSum] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSum(null), [path]);
  if (sum)
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Text size="meta" full>
          {sum}
        </Text>
        <CopyButton value={sum} label="Copy checksum" />
      </span>
    );
  return (
    <Button
      variant="quiet"
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void disk
          .checksum(path)
          .then(setSum, () => undefined)
          .finally(() => setBusy(false));
      }}
    >
      Calculate
    </Button>
  );
}

function diskRows(item: FileItem, info: FileInfo, size: FolderSize | null): PropertyListItem[] {
  const rows: PropertyListItem[] = [
    { label: "Name", value: item.name },
    { label: "Kind", value: info.kindLabel || kindOf(item) },
    {
      label: "Size",
      value: item.folder
        ? size
          ? `${formatBytes(size.bytes)}, ${countText(size.items)}`
          : "—"
        : formatBytes(info.entry.size),
    },
    { label: "Path", value: info.entry.path },
    ...(item.folder && size ? [{ label: "Items", value: countText(size.items) }] : []),
    { label: "Modified", value: formatDate(info.entry.modifiedMs) },
    { label: "Created", value: formatDate(info.entry.createdMs) },
  ];
  if (info.dimensions)
    rows.push({
      label: "Dimensions",
      value: `${info.dimensions.width} × ${info.dimensions.height}`,
    });
  if (info.defaultApp) rows.push({ label: "Opens with", value: info.defaultApp });
  if (info.entry.linkTarget) rows.push({ label: "Original", value: info.entry.linkTarget });
  if (info.entry.tags?.length)
    rows.push({ label: "Tags", value: <TagDots tags={info.entry.tags} /> });
  rows.push({ label: "Permissions", value: info.permissions });
  if (info.owner) rows.push({ label: "Owner", value: info.owner });
  if (!item.folder) rows.push({ label: "Checksum", value: <Checksum path={info.entry.path} /> });
  return rows;
}

function otherRows(item: FileItem): PropertyListItem[] {
  const source = item.source;
  const rows: PropertyListItem[] = [
    { label: "Name", value: item.name },
    { label: "Kind", value: kindOf(item) },
    { label: "Size", value: item.folder ? "—" : formatBytes(item.size) },
  ];
  if (source.kind === "drive") {
    rows.push({ label: "Where", value: parentOf(source.entry.path) });
    rows.push({ label: "Modified", value: formatDate(source.entry.mtime_ms) });
    if (source.entry.modified_by_name)
      rows.push({ label: "Changed by", value: source.entry.modified_by_name });
  } else if (source.kind === "project") {
    rows.push(
      { label: "Where", value: parentOf(source.path) },
      { label: "Modified", value: formatDate(item.modifiedMs) },
    );
  } else if (source.kind === "trash" || source.kind === "agent-trash") {
    rows.push(
      { label: "From", value: parentOf(source.item.originalPath) },
      { label: "Moved", value: formatDate(item.modifiedMs) },
    );
  } else if (source.kind === "drive-trash" && source.entry.trashed_by_name) {
    rows.push({ label: "Trashed by", value: source.entry.trashed_by_name });
  }
  return rows;
}

function FolderPreview({
  item,
  from,
  hidden,
  onOpen,
}: {
  item: FileItem;
  from: FilesPlace;
  hidden: boolean;
  onOpen(item: FileItem): void;
}) {
  const [place] = useState(() => placeInside(item, from));
  const listing = useListing(place, hidden);
  const items = listing.items;
  if (listing.status === "failed")
    return (
      <ErrorState
        inline
        title="This folder couldn't be read"
        line={listing.error ?? "This folder couldn't be read."}
      />
    );
  if (items === null) return <ListRowSkeleton label="What the folder holds" rows={5} />;
  if (!items.length) return <EmptyState inline line="This folder is empty." />;
  return (
    <div role="list" aria-label={`In ${item.name}`} className="grid content-start p-1">
      {items.slice(0, 60).map((inside) => (
        <TreeRow
          key={inside.id}
          label={inside.name}
          icon={itemIcon(inside)}
          end={
            inside.folder ? undefined : (
              <Text size="meta" tone="muted">
                {formatBytes(inside.size)}
              </Text>
            )
          }
          onOpen={() => onOpen(inside)}
        />
      ))}
    </div>
  );
}

function ItemDetails({
  item,
  from,
  hidden,
  onOpen,
}: {
  item: FileItem;
  from: FilesPlace;
  hidden: boolean;
  onOpen(item: FileItem): void;
}) {
  const settled = useSettled();
  const disked = item.source.kind === "disk" ? localPath(item) : undefined;
  const { state, size } = useInfo(disked, item.folder, settled);
  const source = sourceOf(item);
  const previewed = !item.folder && !source.inTrash;
  const folderPreview = item.folder && placeInside(item, from) !== undefined;
  return (
    <div className="flex flex-col">
      {previewed || folderPreview ? (
        <Surface tone="card" radius="lg" className="relative h-52 min-h-0 overflow-y-auto">
          {!settled ? null : previewed ? (
            <FilePreview key={item.id} item={item} compact />
          ) : (
            <FolderPreview item={item} from={from} hidden={hidden} onOpen={onOpen} />
          )}
        </Surface>
      ) : null}
      <Separator className="mt-3" />
      <div className="px-3 pt-3">
        {!disked ? (
          <PropertyList layout="info" label="Details" items={otherRows(item)} />
        ) : state.status === "loading" ? (
          <PaneLoading inline label="Reading its details" />
        ) : state.status === "failed" ? (
          <ErrorState inline title="Its details couldn't be read" line={state.message} />
        ) : (
          <PropertyList layout="info" label="Details" items={diskRows(item, state.info, size)} />
        )}
      </div>
    </div>
  );
}

export function FileInspector({
  items,
  from,
  hidden,
  onOpen,
}: {
  items: FileItem[];
  from: FilesPlace;
  hidden: boolean;
  onOpen(item: FileItem): void;
}) {
  let body;
  if (items.length === 0)
    body = (
      <EmptyState icon={FileSearch} line="Select a file to preview it and view its details." />
    );
  else if (items.length > 1) {
    const bytes = items.reduce((sum, item) => sum + (item.folder ? 0 : item.size), 0);
    body = (
      <EmptyState
        icon={Files}
        title="Multiple items"
        line={`${countText(items.length)} selected, ${formatBytes(bytes)}`}
      />
    );
  } else
    body = (
      <ItemDetails key={items[0].id} item={items[0]} from={from} hidden={hidden} onOpen={onOpen} />
    );
  return (
    <aside aria-label="Preview" className="flex size-full min-h-0 flex-col overflow-y-auto p-3">
      {body}
    </aside>
  );
}
