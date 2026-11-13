import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem } from "../../api/dto/entities";
import type { LibraryPickerProps as MistyLibraryPickerProps } from "@/features/files";
import { SystemErrorNotice } from "@/shared/platform/systemErrors";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ScrollArea,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Surface,
  Text,
} from "@/shared/ui";

import { AudioLines, FileText, Film, ImageIcon, LibraryBig, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MistyLibraryPickerTile } from "./MistyLibraryPickerTile";

const pickerStyles = {
  dialog: [
    "grid h-[min(640px,calc(100vh-64px))] w-[min(720px,calc(100vw-32px))] max-w-none",
    "grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0",
    "max-sm:h-screen max-sm:w-screen max-sm:rounded-none",
  ].join(" "),
} as const;

const mediaOptions: Array<{ value: LibraryMediaFilter; label: string; icon: LucideIcon }> = [
  { value: "all", label: "All media", icon: LibraryBig },
  { value: "image", label: "Images", icon: ImageIcon },
  { value: "video", label: "Videos", icon: Film },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "document", label: "Documents", icon: FileText },
];

export function MistyLibraryPicker({
  spaceId,
  embedded = false,
  active = true,
  selectedIds,
  maximumSelected = 5,
  sourceToggle,
  onCancel,
  onChoose,
}: MistyLibraryPickerProps) {
  const [items, setItems] = useState<SpaceLibraryItem[]>([]);
  const [selection, setSelection] = useState<string[]>(selectedIds.slice(0, maximumSelected));
  const [query, setQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<LibraryMediaFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The Library is read a page at a time; the media type is filtered by the server, so each page
  // holds only that kind.
  const [nextAfter, setNextAfter] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const mediaType = mediaFilter === "all" ? undefined : mediaFilter;

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setItems([]);
    setNextAfter("");
    void spacesApi
      .libraryItems(spaceId, {
        limit: pickerPageSize,
        sort: "recently-added",
        media_type: mediaType,
      })
      .then((result) => {
        if (!current) return;
        setItems(result.items);
        setNextAfter(result.next_after ?? "");
      })
      .catch((nextError: unknown) => {
        if (current) setError(loadErrorText(nextError));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [spaceId, mediaType]);

  const loadMore = async () => {
    if (!nextAfter || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await spacesApi.libraryItems(spaceId, {
        limit: pickerPageSize,
        sort: "recently-added",
        media_type: mediaType,
        after: nextAfter,
      });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !known.has(item.id))];
      });
      setNextAfter(result.next_after ?? "");
    } catch (nextError) {
      setError(loadErrorText(nextError));
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) =>
      [item.display_name, item.file.original_filename, item.tags.join(" ")]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [items, query]);

  const toggleItem = (itemId: string) => {
    setSelection((current) =>
      current.includes(itemId)
        ? current.filter((candidate) => candidate !== itemId)
        : current.length < maximumSelected
          ? [...current, itemId]
          : current,
    );
  };

  const searching = Boolean(query.trim()) || mediaFilter !== "all";

  const panel = (
    <>
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <SearchField
          containerClassName="flex-1"
          aria-label="Search Library"
          autoFocus={active}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder="Search names, filenames, and tags"
        />
        <Select
          value={mediaFilter}
          onValueChange={(value) => setMediaFilter(value as LibraryMediaFilter)}
        >
          <SelectTrigger className="w-36 shrink-0" aria-label="Filter by media type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mediaOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                icon={option.icon}
                label={option.label}
              />
            ))}
          </SelectContent>
        </Select>
      </div>

      <Surface as={ScrollArea} tone="page" className="min-h-0">
        <div className="p-4">
          {loading ? (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
              aria-label="Loading Library"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <PickerTileSkeleton key={index} />
              ))}
            </div>
          ) : error ? (
            <SystemErrorNotice
              error={error}
              scope={`library:picker:${spaceId}`}
              title="Library could not be loaded"
            />
          ) : filteredItems.length === 0 && !nextAfter ? (
            <EmptyState
              title={searching ? "No matching items" : "This Library is empty"}
              line={
                searching
                  ? "Try another search or media type."
                  : "Items added to this Space will appear here."
              }
              action={
                searching
                  ? {
                      label: "Clear filters",
                      variant: "secondary",
                      onClick: () => {
                        setQuery("");
                        setMediaFilter("all");
                      },
                    }
                  : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {filteredItems.map((item) => {
                const selected = selection.includes(item.id);
                const unavailable = !selected && selection.length >= maximumSelected;
                return (
                  <MistyLibraryPickerTile
                    key={item.id}
                    spaceId={spaceId}
                    item={item}
                    selected={selected}
                    disabled={unavailable}
                    onToggle={() => toggleItem(item.id)}
                  />
                );
              })}
              {nextAfter && loadingMore
                ? [0, 1, 2, 3].map((tile) => <PickerTileSkeleton key={`more-${tile}`} />)
                : null}
              {nextAfter && !loadingMore ? (
                <div className="col-span-full grid place-items-center pt-3">
                  <Button variant="secondary" type="button" onClick={() => void loadMore()}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Surface>

      <DialogFooter className="flex-row items-center justify-between gap-4 border-t px-5 py-3 sm:justify-between">
        <Text as="p" tone="muted" className="text-xs">
          {selection.length} of {maximumSelected} selected
        </Text>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={loading || selection.length === 0}
            onClick={() => onChoose(selection)}
          >
            Add {selection.length || ""} item{selection.length === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );

  if (embedded) return panel;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className={pickerStyles.dialog}>
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b px-5 py-3 pr-14 text-left">
          <div className="min-w-0">
            <DialogTitle className="text-base">Choose from Library</DialogTitle>
            <DialogDescription>
              Select up to {maximumSelected} items to reference.
            </DialogDescription>
          </div>
          {sourceToggle}
        </DialogHeader>
        {panel}
      </DialogContent>
    </Dialog>
  );
}

type LibraryMediaFilter = "all" | "image" | "video" | "audio" | "document";

const pickerPageSize = 100;

function loadErrorText(error: unknown) {
  return error instanceof Error ? error.message : "Library items could not be loaded.";
}

/** Shaped like the picker's tiles: the 4:3 thumbnail, then the name and file name. */
function PickerTileSkeleton() {
  return (
    <Surface
      tone="card"
      edge="hairline"
      radius="lg"
      className="flex flex-col overflow-hidden"
      aria-hidden="true"
    >
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="px-2.5 py-2">
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div className="mt-0.5 flex h-3.5 items-center">
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </div>
    </Surface>
  );
}
