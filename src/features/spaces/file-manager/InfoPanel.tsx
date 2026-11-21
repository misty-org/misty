import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  CopyButton,
  ErrorState,
  IconButton,
  PaneLoading,
  PropertyList,
  SideCard,
  TagDots,
  Text,
  type PropertyListItem,
} from "@misty/ui";
import { disk, type FileInfo, type FolderSize } from "@/features/files";
import { FilePreview } from "./FilePreview";
import { countText, formatBytes, formatDate, kindOf, messageOf } from "./format";
import { localPath, parentOf, type FileItem } from "./model";

type Loaded = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; info: FileInfo };

/** Get Info for a disk item, and its folder's size counted once it's read. */
function useInfo(path: string | undefined, folder: boolean) {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  const [size, setSize] = useState<FolderSize | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState({ status: "loading" });
    setSize(null);
    void disk.info(path).then(
      (info) => live && setState({ status: "ready", info }),
      (cause) => live && setState({ status: "failed", message: messageOf(cause, "Its details couldn't be read.") }),
    );
    if (folder) void disk.folderSize(path).then((next) => live && setSize(next), () => undefined);
    return () => {
      live = false;
    };
  }, [path, folder]);
  return { state, size };
}

/** A file's checksum, worked out when asked for, with a copy button once it's there. */
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
    { label: "Kind", value: info.kindLabel || kindOf(item) },
    {
      label: "Size",
      value: item.folder ? (size ? `${formatBytes(size.bytes)}, ${countText(size.items)}` : "—") : formatBytes(info.entry.size),
    },
    { label: "Where", value: info.parent },
    { label: "Created", value: formatDate(info.entry.createdMs) },
    { label: "Modified", value: formatDate(info.entry.modifiedMs) },
  ];
  if (info.dimensions) rows.push({ label: "Dimensions", value: `${info.dimensions.width} × ${info.dimensions.height}` });
  if (info.defaultApp) rows.push({ label: "Opens with", value: info.defaultApp });
  if (info.entry.linkTarget) rows.push({ label: "Original", value: info.entry.linkTarget });
  if (info.entry.tags.length) rows.push({ label: "Tags", value: <TagDots tags={info.entry.tags} /> });
  rows.push({ label: "Permissions", value: info.permissions });
  if (info.owner) rows.push({ label: "Owner", value: info.owner });
  if (!item.folder) rows.push({ label: "Checksum", value: <Checksum path={info.entry.path} /> });
  return rows;
}

/** What Files knows of an item that isn't on the disk: a Space drive's, a project's, or one in a trash. */
function otherRows(item: FileItem): PropertyListItem[] {
  const source = item.source;
  const rows: PropertyListItem[] = [
    { label: "Kind", value: kindOf(item) },
    { label: "Size", value: item.folder ? "—" : formatBytes(item.size) },
  ];
  if (source.kind === "drive") {
    rows.push({ label: "Where", value: parentOf(source.entry.path) });
    rows.push({ label: "Modified", value: formatDate(source.entry.mtime_ms) });
    if (source.entry.modified_by_name) rows.push({ label: "Changed by", value: source.entry.modified_by_name });
  } else if (source.kind === "project") {
    rows.push({ label: "Where", value: parentOf(source.path) }, { label: "Modified", value: formatDate(item.modifiedMs) });
  } else if (source.kind === "trash" || source.kind === "agent-trash") {
    rows.push({ label: "From", value: parentOf(source.item.originalPath) }, { label: "Moved", value: formatDate(item.modifiedMs) });
  } else if (source.kind === "drive-trash" && source.entry.trashed_by_name) {
    rows.push({ label: "Trashed by", value: source.entry.trashed_by_name });
  }
  return rows;
}

/**
 * Get Info as a card floating over the open folder's top right: the file's preview, then its facts. It
 * takes none of the folder's width.
 */
export function InfoPanel({ item, onClose }: { item: FileItem; onClose(): void }) {
  const disked = item.source.kind === "disk" ? localPath(item) : undefined;
  const { state, size } = useInfo(disked, item.folder);
  const previewed = !item.folder && (item.source.kind === "disk" || item.source.kind === "project");
  return (
    <SideCard
      floating
      label={`Info for ${item.name}`}
      corner={
        <IconButton label="Close" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <Text size="title" weight="semibold" tone="bright" full>
          {item.name}
        </Text>
        {previewed ? (
          <div className="relative h-48 min-h-0 overflow-hidden">
            <FilePreview key={item.id} item={item} />
          </div>
        ) : null}
        {!disked ? (
          <PropertyList label="Info" items={otherRows(item)} />
        ) : state.status === "loading" ? (
          <PaneLoading inline label="Reading its details" />
        ) : state.status === "failed" ? (
          <ErrorState inline title="Its details couldn't be read" line={state.message} />
        ) : (
          <PropertyList label="Info" items={diskRows(item, state.info, size)} />
        )}
      </div>
    </SideCard>
  );
}
