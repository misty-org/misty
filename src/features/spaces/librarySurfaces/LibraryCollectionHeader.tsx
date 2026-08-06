import { EllipsisVertical, Pencil, Play, Trash2 } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { BackToCollections } from "./LibraryNothingHere";

const backLinkClass = "border-0 bg-transparent p-0 text-xs text-cream-muted";

const dateGroupLabel = (collection: string) =>
  collection === "recent-days" ? "Recent Days" : collection === "months" ? "Months" : "Years";

/**
 * The title bar for whatever single collection is open.
 *
 * Only one of these branches can apply at a time — a date group, an album, a
 * discovery group, or a bare back link for everything else.
 */
export function LibraryCollectionHeader() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const { collection, selectedCollectionId, canEditLibrary, visibleItems, bulkSaving } = data;
  const { currentDateGroup, currentAlbum, currentDiscoveryGroup } = data;

  if (currentDateGroup)
    return (
      <div className="mb-4">
        <Button
          className={backLinkClass}
          type="button"
          onClick={() => collectionActions.selectCollection(collection)}
        >
          ← {dateGroupLabel(collection)}
        </Button>
        <h4 className="mb-0 mt-2 text-sm">{currentDateGroup.title}</h4>
        <p className="mb-0 mt-1 text-xs text-cream-muted">{currentDateGroup.subtitle}</p>
      </div>
    );

  if (currentAlbum)
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button
            className={backLinkClass}
            type="button"
            onClick={() => {
              data.setSelectedAlbumFolderId(currentAlbum.folder_id ?? "");
              collectionActions.selectCollection("albums");
            }}
          >
            ← Albums
          </Button>
          <h4 className="mb-0 mt-2 text-sm">{currentAlbum.name}</h4>
          {currentAlbum.description ? (
            <p className="mb-0 mt-1 text-xs text-cream-muted">{currentAlbum.description}</p>
          ) : null}
        </div>
        {canEditLibrary ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" aria-label="Album actions">
                <EllipsisVertical size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={collectionActions.openEditAlbum}>
                <Pencil size={13} />
                Edit album
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-cream-bright focus:text-cream-bright"
                onSelect={() => void collectionActions.deleteCurrentAlbum()}
              >
                <Trash2 size={13} />
                Delete album
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );

  if (currentDiscoveryGroup) {
    const isDuplicate = currentDiscoveryGroup.kind === "duplicate";
    return (
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <Button
            className={backLinkClass}
            type="button"
            onClick={() =>
              collectionActions.selectCollection(isDuplicate ? "duplicate" : "collections")
            }
          >
            ← {isDuplicate ? "Duplicates" : "Collections"}
          </Button>
          <h4 className="mb-0 mt-2 text-sm">{currentDiscoveryGroup.title}</h4>
          <p className="mb-0 mt-1 text-xs text-cream-muted">{currentDiscoveryGroup.subtitle}</p>
        </div>
        <div className="flex gap-2">
          {currentDiscoveryGroup.kind === "memory" && visibleItems.length > 0 ? (
            <Button size="sm" type="button" onClick={() => data.setMemoryPlaybackOpen(true)}>
              <Play size={13} />
              Play memory
            </Button>
          ) : null}
          {canEditLibrary && isDuplicate ? (
            <Button
              size="sm"
              type="button"
              disabled={bulkSaving || visibleItems.length < 2}
              onClick={() => void collectionActions.mergeCurrentDuplicates()}
            >
              {bulkSaving ? "Merging…" : "Merge"}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (selectedCollectionId) return <BackToCollections />;
  return null;
}
