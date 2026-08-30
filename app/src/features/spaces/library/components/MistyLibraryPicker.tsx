import { spacesApi } from "@/api/spaces/api";
import type { SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import { SystemErrorActivity } from "@/features/activity";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  cn,
} from "@/shared/ui";
import { Check, File, Image, Music2, Search, Video, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

const pickerStyles = {
  dialog: [
    "grid h-[min(640px,calc(100vh-64px))] w-[min(720px,calc(100vw-32px))] max-w-none",
    "grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0",
    "max-sm:h-screen max-sm:w-screen max-sm:rounded-none",
  ].join(" "),
  searchField: [
    "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-charcoal-border/80 bg-charcoal-bg",
    "px-3 text-cream-muted shadow-xs transition-colors",
  ].join(" "),
  searchInput: [
    "!m-0 !h-full !min-h-0 min-w-0 flex-1 !rounded-none !border-0 !bg-transparent !p-0",
    "text-sm leading-none !shadow-none focus-visible:!ring-0",
  ].join(" "),
} as const;

const mediaOptions: Array<{ value: LibraryMediaFilter; label: string }> = [
  { value: "all", label: "All media" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
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

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    void spacesApi
      .libraryItems(spaceId, { limit: 200, sort: "recently-added" })
      .then((result) => {
        if (current) setItems(result.items);
      })
      .catch((nextError: unknown) => {
        if (current)
          setError(
            nextError instanceof Error ? nextError.message : "Library items could not be loaded.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [spaceId]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const mime = libraryPickerItemMIME(item);
      const matchesMedia =
        mediaFilter === "all" ||
        (mediaFilter === "document" && !/^(image|video|audio)\//.test(mime)) ||
        (mediaFilter !== "document" && mime.startsWith(`${mediaFilter}/`));
      if (!matchesMedia) return false;
      return (
        !normalizedQuery ||
        [item.display_name, item.file.original_filename, item.tags.join(" ")]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      );
    });
  }, [items, mediaFilter, query]);

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
      <div className="flex items-center gap-2 border-b border-charcoal-border px-5 py-3">
        <div className={pickerStyles.searchField} role="search">
          <Search size={15} aria-hidden="true" />
          <Input
            className={pickerStyles.searchInput}
            aria-label="Search Library"
            autoComplete="off"
            autoFocus={active}
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search names, filenames, and tags"
          />
          {query ? (
            <Button
              className="size-6 shrink-0"
              size="icon"
              variant="ghost"
              type="button"
              aria-label="Clear Library search"
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </Button>
          ) : null}
        </div>
        <Select
          value={mediaFilter}
          onValueChange={(value) => setMediaFilter(value as LibraryMediaFilter)}
        >
          <SelectTrigger className="w-[142px] shrink-0" aria-label="Filter by media type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mediaOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="min-h-0 bg-charcoal-bg">
        <div className="p-4">
          {loading ? (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
              aria-label="Loading Library"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <Skeleton className="aspect-[4/3] rounded-lg" key={index} />
              ))}
            </div>
          ) : error ? (
            <SystemErrorActivity
              error={error}
              scope={`library:picker:${spaceId}`}
              title="Library could not be loaded"
              target={{ kind: "route", href: `/spaces/${encodeURIComponent(spaceId)}/library` }}
            />
          ) : filteredItems.length === 0 ? (
            <EmptyState
              title={searching ? "No matching items" : "This Library is empty"}
              description={
                searching
                  ? "Try another search or media type."
                  : "Items added to this Space will appear here."
              }
              action={
                searching ? (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setMediaFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {filteredItems.map((item) => {
                const selected = selection.includes(item.id);
                const unavailable = !selected && selection.length >= maximumSelected;
                return (
                  <Button
                    className={cn(
                      "group relative h-auto flex-col items-stretch justify-start gap-0 overflow-hidden whitespace-normal rounded-lg p-0 text-left shadow-xs",
                      selected
                        ? "ring-2 ring-charcoal-active"
                        : "bg-charcoal-card inset-ring-1 inset-ring-cream/10 hover:bg-charcoal-hover",
                    )}
                    variant="ghost"
                    type="button"
                    key={item.id}
                    disabled={unavailable}
                    aria-pressed={selected}
                    onClick={() => toggleItem(item.id)}
                  >
                    <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-charcoal-card">
                      <MistyLibraryPickerThumbnail spaceId={spaceId} item={item} />
                    </span>
                    <span className="block min-w-0 px-2.5 py-2">
                      <span className="block truncate text-xs font-medium">
                        {item.display_name}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] font-normal text-cream-muted">
                        {item.file.original_filename}
                      </span>
                    </span>
                    {selected ? (
                      <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-md bg-charcoal-active text-cream-bright shadow-xs">
                        <Check className="size-3" />
                      </span>
                    ) : null}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <DialogFooter className="flex-row items-center justify-between gap-4 border-t border-charcoal-border px-5 py-3 sm:justify-between">
        <p className="text-xs text-cream-muted">
          {selection.length} of {maximumSelected} selected
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
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
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-charcoal-border px-5 py-3 pr-14 text-left">
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

function MistyLibraryPickerThumbnail({
  spaceId,
  item,
}: {
  spaceId: string;
  item: SpaceLibraryItem;
}) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [url, setURL] = useState("");
  const mime = libraryPickerItemMIME(item);
  const previewable =
    /^(image|video)\//.test(mime) || Number(item.file.intrinsic_metadata.width ?? 0) > 0;

  useEffect(() => {
    const root = rootRef.current;
    if (!root || visible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "160px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !previewable) return;
    let current = true;
    let objectURL = "";
    void spacesApi
      .libraryPreview(spaceId, item.id, "", item.version)
      .then((blob) => {
        if (!current) return;
        objectURL = URL.createObjectURL(blob);
        setURL(objectURL);
      })
      .catch(() => undefined);
    return () => {
      current = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [item.id, item.version, previewable, spaceId, visible]);

  const Icon = mime.startsWith("image/")
    ? Image
    : mime.startsWith("video/")
      ? Video
      : mime.startsWith("audio/")
        ? Music2
        : File;
  return (
    <span ref={rootRef} className="grid size-full place-items-center text-cream-muted">
      {url ? (
        <img className="size-full object-cover" src={url} alt="" />
      ) : (
        <Icon className="size-7" />
      )}
    </span>
  );
}

function libraryPickerItemMIME(item: SpaceLibraryItem): string {
  const metadata = item.file.intrinsic_metadata;
  return String(
    metadata.server_detected_mime_type ??
      metadata.client_declared_mime_type ??
      "application/octet-stream",
  )
    .split(";")[0]
    .toLocaleLowerCase();
}

export type LibraryMediaFilter = "all" | "image" | "video" | "audio" | "document";

export interface MistyLibraryPickerProps {
  spaceId: string;
  /** Render only the picker panel when a parent owns the shared dialog shell. */
  embedded?: boolean;
  /** Whether this embedded panel is currently visible. */
  active?: boolean;
  /** Source switcher rendered in the header when this picker is hosted by MistyPicker. */
  sourceToggle?: ReactNode;
  selectedIds: string[];
  maximumSelected?: number;
  onCancel: () => void;
  onChoose: (itemIds: string[]) => void;
}
