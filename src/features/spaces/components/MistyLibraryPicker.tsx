import type { LibraryMediaFilter } from "@/models/types/features/spaces/components/MistyLibraryPicker";
export type { LibraryMediaFilter } from "@/models/types/features/spaces/components/MistyLibraryPicker";
import type { MistyLibraryPickerProps } from "@/models/interfaces/features/spaces/components/MistyLibraryPicker";
export type { MistyLibraryPickerProps } from "@/models/interfaces/features/spaces/components/MistyLibraryPicker";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Check, File, Image, Music2, Search, Video } from "lucide-react";

import { Badge } from "@/ui";
import { Button } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { ScrollArea } from "@/ui";
import { Skeleton } from "@/ui";
import { ToggleGroup, ToggleGroupItem } from "@/ui";
import { cn } from "@/ui";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";

const filters: Array<{ value: LibraryMediaFilter; label: string; icon: typeof File }> = [
  { value: "all", label: "All items", icon: File },
  { value: "image", label: "Images", icon: Image },
  { value: "video", label: "Videos", icon: Video },
  { value: "audio", label: "Audio", icon: Music2 },
  { value: "document", label: "Documents", icon: File },
];

export function MistyLibraryPicker({
  spaceId,
  selectedIds,
  maximumSelected = 5,
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

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="grid h-[min(720px,calc(100vh-48px))] w-[min(1120px,calc(100vw-48px))] max-w-none grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 max-sm:h-[calc(100vh-var(--misty-window-titlebar-inset))] max-sm:w-screen max-sm:rounded-none">
        <DialogHeader className="border-b border-border/60 px-6 py-4 pr-14 text-left">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted/60 text-muted-foreground">
              <BookOpenText className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Choose from Library</DialogTitle>
              <DialogDescription className="mt-1">
                Select Library items to reference in this message.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-14 items-center gap-3 border-b border-border/60 px-5 py-2.5">
          <div
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border/80 bg-background px-3 text-muted-foreground focus-within:ring-1 focus-within:ring-ring"
            role="search"
          >
            <Search aria-hidden="true" className="size-4" />
            <Input
              className="h-full border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              aria-label="Search Library"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names, filenames, and tags"
            />
          </div>
          <Badge variant="secondary" className="shrink-0 font-normal max-sm:hidden">
            {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"}
          </Badge>
        </div>

        <div className="grid min-h-0 grid-cols-[196px_minmax(0,1fr)] max-md:grid-cols-1">
          <aside className="min-h-0 border-r border-border/60 bg-muted/20 p-3 max-md:border-b max-md:border-r-0">
            <p className="mb-2 px-2 text-xs font-medium text-muted-foreground max-md:hidden">
              Media
            </p>
            <ToggleGroup
              className="grid w-full gap-1 max-md:flex max-md:justify-start max-md:overflow-x-auto"
              type="single"
              value={mediaFilter}
              onValueChange={(value) => {
                if (value) setMediaFilter(value as LibraryMediaFilter);
              }}
              aria-label="Filter Library media"
            >
              {filters.map((filter) => {
                const Icon = filter.icon;
                return (
                  <ToggleGroupItem
                    className="h-9 w-full justify-start gap-2 border-0 px-2.5 text-sm max-md:w-auto max-md:shrink-0"
                    key={filter.value}
                    value={filter.value}
                  >
                    <Icon className="size-4" />
                    {filter.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </aside>

          <ScrollArea className="min-h-0 bg-background">
            <main className="p-4">
              {loading ? (
                <div
                  className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3"
                  aria-label="Loading Library"
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <Skeleton className="aspect-[4/5] rounded-lg" key={index} />
                  ))}
                </div>
              ) : error ? (
                <div className="grid min-h-64 place-items-center px-8 text-center">
                  <div>
                    <p className="text-sm font-medium">Library could not be loaded</p>
                    <p className="mt-1 text-sm text-destructive">{error}</p>
                  </div>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="grid min-h-64 place-items-center text-center">
                  <div>
                    <Search className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">No matching Library items</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Try another search or media type.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
                  {filteredItems.map((item) => {
                    const selected = selection.includes(item.id);
                    const unavailable = !selected && selection.length >= maximumSelected;
                    return (
                      <Button
                        className={cn(
                          "group relative h-auto flex-col items-stretch justify-start overflow-hidden whitespace-normal rounded-lg p-0 text-left shadow-xs",
                          selected
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border/60 bg-card hover:bg-accent/40",
                        )}
                        variant="outline"
                        type="button"
                        key={item.id}
                        disabled={unavailable}
                        aria-pressed={selected}
                        onClick={() => toggleItem(item.id)}
                      >
                        <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden border-b border-border/60 bg-muted">
                          <MistyLibraryPickerThumbnail spaceId={spaceId} item={item} />
                        </span>
                        <span className="block min-w-0 px-3 py-2.5">
                          <span className="block truncate text-xs font-medium">
                            {item.display_name}
                          </span>
                          <span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">
                            {item.file.original_filename}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "absolute right-2 top-2 grid size-6 place-items-center rounded-full border shadow-xs",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-white/30 bg-black/50 text-transparent group-hover:text-white/50",
                          )}
                        >
                          <Check className="size-3.5" />
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </main>
          </ScrollArea>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-4 border-t border-border/60 px-5 py-3 sm:justify-between">
          <p className="text-sm text-muted-foreground">
            <strong className="font-medium text-foreground">{selection.length}</strong> of{" "}
            {maximumSelected} selected
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
    <span ref={rootRef} className="grid size-full place-items-center text-muted-foreground">
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
