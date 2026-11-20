import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Pressable,
  SearchField,
  Skeleton,
  Surface,
  Text,
} from "@misty/ui";
import { spacesApi } from "../api/api";
import type { SpaceLibraryItem } from "../api/dto/entities";
import { formatBytes } from "../library/libraryFormat";
import { libraryFileTypeLabel, LibraryItemThumbnail } from "../library/SpaceLibraryPrimitives";
import { acceptsFile, fileRef, type AppFileRef } from "./spaceAppFiles";

/**
 * The Space's Media, to choose files for an app that asked to open some (its own Open, through the shim). It lists
 * the files the app accepts, and answers with what was chosen, or nothing when the person closes it.
 */
export function PickFilesDialog({
  spaceId,
  accept,
  multiple,
  onDone,
}: {
  spaceId: string;
  accept: string[];
  multiple: boolean;
  onDone(files: AppFileRef[]): void;
}) {
  const [files, setFiles] = useState<SpaceLibraryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    setFailed(false);
    spacesApi.libraryItems(spaceId, { sort: "recently-added", direction: "desc", limit: 200 }).then(
      (result) => {
        if (live)
          setFiles(
            result.items.filter((item) => {
              const file = fileRef(item);
              return acceptsFile(accept, file.mime, file.name);
            }),
          );
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
    // `accept` is a list made again by each request, so it stands in by its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, accept.join(","), attempt]);

  const pick = (item: SpaceLibraryItem) => {
    if (!multiple) return onDone([fileRef(item)]);
    setChosen((now) =>
      now.includes(item.id) ? now.filter((id) => id !== item.id) : [...now, item.id],
    );
  };
  const visibleFiles = (files ?? []).filter((item) =>
    fileRef(item).name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onDone([])}>
      <DialogContent
        aria-describedby={undefined}
        className="w-[min(48rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0"
      >
        <Surface
          tone="page"
          className="grid max-h-[min(44rem,calc(100vh-2rem))] min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]"
        >
          <DialogHeader className="flex-row items-center justify-between gap-4 px-6 pb-3 pt-5 text-left">
            <DialogTitle className="text-base">Choose from Media</DialogTitle>
            {files ? (
              <Text tone="muted" className="shrink-0">
                {files.length} {files.length === 1 ? "item" : "items"}
              </Text>
            ) : null}
          </DialogHeader>
          <div className="px-6 pb-4">
            <SearchField
              aria-label="Search Media"
              placeholder="Search Media"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="misty-transient-scrollbar min-h-0 overflow-y-auto px-6 pb-5">
            {failed ? (
              <ErrorState
                inline
                title="Media couldn't load"
                action={{
                  label: "Try again",
                  variant: "secondary",
                  onClick: () => setAttempt((n) => n + 1),
                }}
              />
            ) : !files ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="h-48 w-full rounded-xl" />
                ))}
              </div>
            ) : files.length === 0 ? (
              <EmptyState
                inline
                title="No files to open"
                line="Files this app can open show up here."
              />
            ) : visibleFiles.length === 0 ? (
              <EmptyState inline title="No matching files" line="Try a different name." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleFiles.map((item) => {
                  const file = fileRef(item);
                  const selected = chosen.includes(item.id);
                  return (
                    <Surface
                      key={item.id}
                      as="article"
                      tone="card"
                      edge={selected ? "strong" : "hairline"}
                      radius="xl"
                      className="min-w-0 overflow-hidden"
                    >
                      <Pressable
                        className="relative block w-full text-left"
                        wash="card"
                        aria-pressed={multiple ? selected : undefined}
                        aria-label={`${multiple ? (selected ? "Deselect" : "Select") : "Open"} ${file.name}`}
                        onClick={() => pick(item)}
                      >
                        <Surface
                          tone="active"
                          className="relative aspect-[4/3] w-full overflow-hidden [&>svg]:size-10"
                        >
                          <LibraryItemThumbnail spaceId={spaceId} item={item} />
                          {multiple && selected ? (
                            <Check aria-hidden="true" className="absolute right-3 top-3" />
                          ) : null}
                        </Surface>
                        <div className="min-w-0 px-3 pb-3 pt-2.5">
                          <Text size="control" className="block">
                            {file.name}
                          </Text>
                          <Text tone="muted" size="meta" className="mt-1 block">
                            {libraryFileTypeLabel(item)} · {formatBytes(file.size)}
                          </Text>
                        </div>
                      </Pressable>
                    </Surface>
                  );
                })}
              </div>
            )}
          </div>
          {multiple ? (
            <DialogFooter>
              <Button variant="quiet" size="lg" onClick={() => onDone([])}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={chosen.length === 0}
                onClick={() =>
                  onDone((files ?? []).filter((item) => chosen.includes(item.id)).map(fileRef))
                }
              >
                Choose
              </Button>
            </DialogFooter>
          ) : null}
        </Surface>
      </DialogContent>
    </Dialog>
  );
}
