import { Button } from "@/shared/ui";
import { Folder, Pencil, Plus, Trash2 } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { AlbumCover } from "../SpaceLibraryPrimitives";
import { collectionCardClassName } from "../components/SpaceLibraryCollections";
import { LibraryNothingHere } from "./LibraryNothingHere";

/** The album browser: folders and albums for the current folder level. */
export function AlbumsIndex() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const { collection, selectedCollectionId, canEditLibrary, spaceId } = data;
  const { currentAlbumFolder, visibleAlbumFolders, visibleAlbumsForFolder } = data;
  if (collection !== "albums" || selectedCollectionId) return null;

  return (
    <div className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {currentAlbumFolder ? (
            <Button
              className="border-0 bg-transparent p-0 text-xs text-cream-muted"
              type="button"
              onClick={() =>
                data.setSelectedAlbumFolderId(currentAlbumFolder.parent_folder_id ?? "")
              }
            >
              ←
            </Button>
          ) : null}
          <h4 className="m-0 text-sm">{currentAlbumFolder?.name ?? "Albums"}</h4>
        </div>
        {canEditLibrary ? (
          <div className="flex gap-2">
            {currentAlbumFolder ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void collectionActions.renameAlbumFolder()}
                >
                  <Pencil size={12} />
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void collectionActions.deleteAlbumFolder()}
                >
                  <Trash2 size={12} />
                  Delete
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => void collectionActions.createAlbumFolder()}
            >
              <Folder size={13} />
              New folder
            </Button>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={collectionActions.openCreateAlbum}
            >
              <Plus size={13} />
              New album
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {visibleAlbumFolders.map((folder) => (
          <Button
            className={`${collectionCardClassName} p-4`}
            type="button"
            key={folder.id}
            onClick={() => data.setSelectedAlbumFolderId(folder.id)}
          >
            <Folder className="size-[26px]" />
            <span className="mt-5 block truncate text-xs font-medium">{folder.name}</span>
            <span className="mt-1 block text-[10px] text-cream-muted">
              {folder.album_count + folder.folder_count} items
            </span>
          </Button>
        ))}
        {visibleAlbumsForFolder.map((album) => (
          <Button
            className={collectionCardClassName}
            type="button"
            key={album.id}
            onClick={() => collectionActions.selectCollection("albums", album.id)}
          >
            <AlbumCover spaceId={spaceId} itemId={album.cover_item_id} />
            <span className="block p-3">
              <span className="block truncate text-xs font-medium">{album.name}</span>
              <span className="mt-1 block text-[10px] text-cream-muted">
                {album.item_count} items
              </span>
            </span>
          </Button>
        ))}
      </div>

      {visibleAlbumFolders.length === 0 && visibleAlbumsForFolder.length === 0 ? (
        <LibraryNothingHere />
      ) : null}
    </div>
  );
}
