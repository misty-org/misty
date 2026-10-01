import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
import { Button, CollectionItems } from "@/shared/ui";
import { Folder, Pencil, Trash2 } from "lucide-react";
import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { LibraryNothingHere } from "./LibraryNothingHere";

/** The album browser: folders and albums for the current folder level. */
export function AlbumsIndex() {
  const { data, collectionActions } = useSpaceLibraryContext();
  const { collection, selectedCollectionId, canEditLibrary, spaceId } = data;
  const { currentAlbumFolder, visibleAlbumFolders, visibleAlbumsForFolder } = data;
  const creator = useSpaceItemCreator(spaceId);
  if (collection !== "albums" || selectedCollectionId) return null;

  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(data.searchInput.trim().toLocaleLowerCase());
  const folders = visibleAlbumFolders.filter((folder) => matches(folder.name));
  const albums = visibleAlbumsForFolder.filter((album) => matches(album.name));
  return (
    <div className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {currentAlbumFolder ? (
            <Button
              variant="link"
              size="none"
              className="text-xs text-cream-muted"
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
          </div>
        ) : null}
      </div>

      <CollectionItems
        columnSetId="albums"
        fields={["Items", "Created"]}
        view={data.libraryViewMode}
        categoryLabel="Type"
        items={[
          ...folders.map((folder) => ({
            id: folder.id,
            title: folder.name,
            icon: <Folder />,
            category: "Folder",
            creator: creator(folder.created_by_user_id),
            metadata: { Created: new Date(folder.created_at).toLocaleDateString() },
            sortValues: { Created: Date.parse(folder.created_at) },
            updatedAt: folder.updated_at,
            updated: new Date(folder.updated_at).toLocaleDateString(),
            onOpen: () => data.setSelectedAlbumFolderId(folder.id),
          })),
          ...albums.map((album) => ({
            id: album.id,
            title: album.name,
            icon: <Folder />,
            category: "Album",
            metadata: {
              Items: album.item_count,
              Created: new Date(album.created_at).toLocaleDateString(),
            },
            sortValues: { Created: Date.parse(album.created_at) },
            creator: creator(album.created_by_user_id),
            updatedAt: album.updated_at,
            updated: new Date(album.updated_at).toLocaleDateString(),
            onOpen: () => collectionActions.selectCollection("albums", album.id),
          })),
        ]}
      />

      {folders.length === 0 && albums.length === 0 ? <LibraryNothingHere /> : null}
    </div>
  );
}
