import { InUseMark, type CollectionColumn, type CollectionItem } from "@misty/ui";
import { imageFileUrl, personTone } from "@/features/agents";
import { FileNameIcon } from "@/features/files";
import { driveInUsePeople, driveSyncMark, formatDriveBytes } from "../../drive/drive_entries";
import { isFolderEntry, type PickerEntry } from "./use_picker_listing";

const PREVIEWED = new Set("png apng jpg jpeg gif webp avif svg bmp ico".split(" "));

const extensionOf = (name: string) =>
  name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";

const kindOf = (entry: PickerEntry) => {
  if (entry.folder) return "Folder";
  return extensionOf(entry.name).toUpperCase() || "File";
};

const changedMs = (entry: PickerEntry) => entry.changedAt;

const changedText = (entry: PickerEntry) => {
  const at = changedMs(entry);
  if (!Number.isFinite(at) || at <= 0) return "—";
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const pickerColumns: CollectionColumn[] = [
  {
    key: "changed",
    label: "Date modified",
    render: (item) => item.updated,
    sortValue: (item) => item.sortValues?.changed,
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

function Preview({ path, changedAt }: { path: string; changedAt: number }) {
  return <img alt="" loading="lazy" src={imageFileUrl(path, changedAt)} />;
}

export function pickerItem(
  _spaceId: string,
  entry: PickerEntry,
  onOpen: (entry: PickerEntry) => void,
): CollectionItem {
  const folder = isFolderEntry(entry);
  const pictured = entry.kind === "local" && !folder && PREVIEWED.has(extensionOf(entry.name));
  const inUse = entry.kind === "drive" ? driveInUsePeople(entry.entry, personTone) : [];
  return {
    id: entry.id,
    title: entry.name,
    icon: <FileNameIcon name={entry.name} kind={folder ? "folder" : "file"} />,
    preview:
      pictured && entry.kind === "local" ? (
        <Preview path={entry.path} changedAt={entry.changedAt} />
      ) : undefined,
    category: kindOf(entry),
    updated: changedText(entry),
    metadata: { Size: folder ? "—" : formatDriveBytes(entry.size) },
    marker: inUse.length ? <InUseMark people={inUse} /> : undefined,
    sync: entry.kind === "drive" && !folder ? driveSyncMark(entry.entry) : undefined,
    sortValues: { changed: changedMs(entry), size: folder ? undefined : entry.size },
    onOpen: () => onOpen(entry),
    selectable: true,
  };
}
