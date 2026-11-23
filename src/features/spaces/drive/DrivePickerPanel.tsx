import { ArrowUp } from "lucide-react";
import { useState, type MouseEvent } from "react";
import {
  Button,
  CollectionItems,
  CollectionSkeleton,
  DialogBody,
  DialogFooter,
  EmptyState,
  ErrorState,
  IconButton,
  SearchField,
  Text,
} from "@misty/ui";
import type { DrivePickerProps } from "@/features/files";
import { pickerColumns, pickerItem } from "../apps/file-picker/PickerItems";
import {
  enclosingFolders,
  placeName,
  type SpaceDrivePlace,
} from "../apps/file-picker/picker_places";
import { usePickerListing, type PickerEntry } from "../apps/file-picker/use_picker_listing";

const NO_FILTER: string[] = [];

export function DrivePickerPanel({
  spaceId,
  maximumSelected = 5,
  onCancel,
  onChoose,
}: DrivePickerProps) {
  const [place, setPlace] = useState<SpaceDrivePlace>({ kind: "space-drive", spaceId, path: "/" });
  const listing = usePickerListing(spaceId, place, NO_FILTER);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PickerEntry[]>([]);

  const go = (path: string) => {
    setPlace({ kind: "space-drive", spaceId, path });
    setQuery("");
  };
  const enclosing = enclosingFolders(place);
  const up = enclosing.length > 1 ? enclosing[enclosing.length - 2] : undefined;
  const needle = query.trim().toLocaleLowerCase();
  const entries =
    listing.status === "ready"
      ? listing.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle))
      : [];
  const files = selected.flatMap((entry) => (entry.kind === "drive" ? [entry.entry] : []));

  const open = (entry: PickerEntry) => {
    if (entry.kind !== "drive") return;
    if (entry.folder) return go(entry.entry.path);
    onChoose([entry.entry]);
  };
  const select = (event: MouseEvent, id: string, onOpen: () => void) => {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    if (event.detail !== 1 || entry.folder) return onOpen();
    const many = event.metaKey || event.ctrlKey || event.shiftKey;
    setSelected((now) => {
      if (!many) return [entry];
      if (now.some((other) => other.id === id)) return now.filter((other) => other.id !== id);
      return now.length >= maximumSelected ? now : [...now, entry];
    });
  };

  const body =
    listing.status === "loading" ? (
      <CollectionSkeleton label="Loading files" view="list" icons />
    ) : listing.status === "failed" ? (
      <ErrorState
        inline
        title="Files couldn't load"
        action={{ label: "Try again", variant: "secondary", onClick: listing.retry }}
      />
    ) : listing.entries.length === 0 ? (
      <EmptyState inline title="This folder is empty" line="Files in the Space show up here." />
    ) : entries.length === 0 ? (
      <EmptyState inline title="No matching files" line="Try a different name." />
    ) : (
      <>
        <CollectionItems
          view="list"
          columns={pickerColumns}
          columnSetId="file-picker"
          remember="file-picker"
          sortResetKey={place.path}
          listIcons
          items={entries.map((entry) => pickerItem(spaceId, entry, open))}
          selectedIds={selected.map((entry) => entry.id)}
          onSelect={select}
        />
        {listing.more ? (
          <Button
            variant="secondary"
            className="mx-auto mt-4 flex"
            disabled={listing.loadingMore}
            onClick={listing.more}
          >
            Load more
          </Button>
        ) : null}
      </>
    );

  return (
    <>
      <div className="flex items-center gap-2 border-b px-5 py-3">
        {up ? (
          <IconButton label="Enclosing folder" onClick={() => go(up.path)}>
            <ArrowUp />
          </IconButton>
        ) : null}
        <Text size="control" weight="semibold" tone="bright" className="min-w-0 flex-1" full>
          {placeName(place)}
        </Text>
        <SearchField
          aria-label={`Search ${placeName(place)}`}
          placeholder="Search"
          containerClassName="w-48 shrink-0"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <DialogBody className="min-h-0 overflow-y-auto p-4">{body}</DialogBody>
      <DialogFooter className="px-5 py-3">
        <Button variant="quiet" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={files.length === 0}
          onClick={() => onChoose(files)}
        >
          Add
        </Button>
      </DialogFooter>
    </>
  );
}
