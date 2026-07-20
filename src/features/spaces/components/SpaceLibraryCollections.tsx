import { BookOpenText as LibraryIcon, Folder, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useSpaceLibraryContext } from "../SpaceLibraryContext";
import { formatBytes, formatTime } from "../libraryFormat";
import { AlbumCover, LibraryItemThumbnail } from "../SpaceLibraryPrimitives";

const collectionRailCardClassName = [
  "w-[180px] shrink-0 overflow-hidden rounded-xl border-0 bg-card p-0 text-left shadow-xs",
  "ring-1 ring-foreground/10 transition-colors hover:bg-accent",
].join(" ");

const collectionRailGroupCardClassName = [
  "w-[180px] shrink-0 rounded-xl border-0 bg-card p-4 text-left shadow-xs",
  "ring-1 ring-foreground/10 transition-colors hover:bg-accent",
].join(" ");

export function SpaceLibraryCollectionOverview() {
  return (
    <div className="grid gap-8">
      <RecentlyAddedRail />
      <AlbumsRail />
      <GroupsRail />
    </div>
  );
}

export function SpaceLibraryAlbumsOverview() {
  const {
    data: {
      spaceId,
      canEditLibrary,
      currentAlbumFolder,
      visibleAlbumFolders,
      visibleAlbumsForFolder,
      setSelectedAlbumFolderId,
    },
    collectionActions: {
      createAlbumFolder,
      deleteAlbumFolder,
      openCreateAlbum,
      renameAlbumFolder,
      selectCollection,
    },
  } = useSpaceLibraryContext();

  return (
    <div className="mb-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {currentAlbumFolder ? (
            <Button
              className="border-0 bg-transparent p-0 text-xs text-muted-foreground"
              type="button"
              onClick={() => setSelectedAlbumFolderId(currentAlbumFolder.parent_folder_id ?? "")}
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
                  onClick={() => void renameAlbumFolder()}
                >
                  <Pencil size={12} />
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => void deleteAlbumFolder()}
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
              onClick={() => void createAlbumFolder()}
            >
              <Folder size={13} />
              New folder
            </Button>
            <Button size="sm" variant="outline" type="button" onClick={openCreateAlbum}>
              <Plus size={13} />
              New album
            </Button>
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {visibleAlbumFolders.map((folder) => (
          <Button
            className="rounded-xl border-0 bg-card p-4 text-left shadow-xs ring-1 ring-foreground/10 hover:bg-accent"
            type="button"
            key={folder.id}
            onClick={() => setSelectedAlbumFolderId(folder.id)}
          >
            <Folder size={26} />
            <p className="mb-0 mt-5 truncate text-xs font-medium">{folder.name}</p>
            <p className="mb-0 mt-1 text-[10px] text-muted-foreground">
              {folder.album_count + folder.folder_count} items
            </p>
          </Button>
        ))}
        {visibleAlbumsForFolder.map((album) => (
          <Button
            className="overflow-hidden rounded-xl border-0 bg-card p-0 text-left shadow-xs ring-1 ring-foreground/10 hover:bg-accent"
            type="button"
            key={album.id}
            onClick={() => selectCollection("albums", album.id)}
          >
            <AlbumCover spaceId={spaceId} itemId={album.cover_item_id} />
            <div className="p-3">
              <p className="m-0 truncate text-xs font-medium">{album.name}</p>
              <p className="mb-0 mt-1 text-[10px] text-muted-foreground">
                {album.item_count} items
              </p>
            </div>
          </Button>
        ))}
      </div>
      {visibleAlbumFolders.length === 0 && visibleAlbumsForFolder.length === 0 ? (
        <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
          Nothing to see here...
        </div>
      ) : null}
    </div>
  );
}

export function SpaceLibraryGroupsOverview() {
  const {
    data: { groups, canEditLibrary },
    collectionActions: { createGroup, selectCollection },
  } = useSpaceLibraryContext();

  return (
    <div className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="m-0 text-sm">Groups</h4>
        {canEditLibrary ? (
          <Button size="sm" variant="outline" type="button" onClick={() => void createGroup()}>
            <Plus size={13} />
            New smart group
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {groups.map((group) => (
          <Button
            className="rounded-xl border-0 bg-card p-4 text-left shadow-xs ring-1 ring-foreground/10 hover:bg-accent"
            type="button"
            key={group.id}
            onClick={() => void selectCollection("groups", group.id)}
          >
            <LibraryIcon size={22} />
            <p className="mb-0 mt-3 truncate text-xs font-medium">{group.name}</p>
            <p className="mb-0 mt-1 truncate text-[10px] text-muted-foreground">
              {group.rules.all.length} rules
            </p>
          </Button>
        ))}
      </div>
    </div>
  );
}

function RecentlyAddedRail() {
  const {
    data: {
      spaceId,
      displayItems,
      libraryViewerTriggerRef,
      setSelectedItemId,
      sensitiveCollectionToken,
    },
  } = useSpaceLibraryContext();

  return (
    <section>
      <h4 className="mb-3 mt-0 text-sm">Recently Added</h4>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {displayItems.slice(0, 10).map((item) => (
          <Button
            className={collectionRailCardClassName}
            type="button"
            key={item.id}
            onClick={(event) => {
              libraryViewerTriggerRef.current = event.currentTarget;
              setSelectedItemId(item.id);
            }}
            aria-label={`Open ${item.display_name}`}
          >
            <span className="grid aspect-[4/3] w-full place-items-center overflow-hidden bg-muted text-muted-foreground">
              <LibraryItemThumbnail
                spaceId={spaceId}
                item={item}
                reauthenticationToken={sensitiveCollectionToken}
              />
            </span>
            <span className="block p-3">
              <span className="block truncate text-xs font-medium text-foreground">
                {item.display_name}
              </span>
              <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                {formatBytes(Number(item.file.intrinsic_metadata.byte_size ?? 0))} ·{" "}
                {formatTime(item.added_at)}
              </span>
            </span>
          </Button>
        ))}
        {displayItems.length === 0 ? (
          <p className="m-0 py-4 text-xs text-muted-foreground">No recently added items.</p>
        ) : null}
      </div>
    </section>
  );
}

function AlbumsRail() {
  const {
    data: { spaceId, albums, canEditLibrary },
    collectionActions: { openCreateAlbum, selectCollection },
  } = useSpaceLibraryContext();

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="m-0 text-sm">Albums</h4>
        {canEditLibrary ? (
          <Button size="sm" variant="outline" type="button" onClick={openCreateAlbum}>
            <Plus size={13} />
            New album
          </Button>
        ) : null}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {albums.map((album) => (
          <Button
            className={collectionRailCardClassName}
            type="button"
            key={album.id}
            onClick={() => selectCollection("albums", album.id)}
          >
            <AlbumCover spaceId={spaceId} itemId={album.cover_item_id} />
            <span className="block p-3">
              <span className="block truncate text-xs font-medium">{album.name}</span>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                {album.item_count} items
              </span>
            </span>
          </Button>
        ))}
        {albums.length === 0 ? (
          <p className="m-0 py-4 text-xs text-muted-foreground">No albums yet.</p>
        ) : null}
      </div>
    </section>
  );
}

function GroupsRail() {
  const {
    data: { groups, canEditLibrary },
    collectionActions: { createGroup, selectCollection },
  } = useSpaceLibraryContext();

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="m-0 text-sm">Groups</h4>
        {canEditLibrary ? (
          <Button size="sm" variant="outline" type="button" onClick={() => void createGroup()}>
            <Plus size={13} />
            New smart group
          </Button>
        ) : null}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {groups.map((group) => (
          <Button
            className={collectionRailGroupCardClassName}
            type="button"
            key={group.id}
            onClick={() => selectCollection("groups", group.id)}
          >
            <LibraryIcon size={22} />
            <span className="mb-0 mt-5 block truncate text-xs font-medium">{group.name}</span>
            <span className="mt-1 block truncate text-[10px] text-muted-foreground">
              {group.rules.all.length} rules
            </span>
          </Button>
        ))}
        {groups.length === 0 ? (
          <p className="m-0 py-4 text-xs text-muted-foreground">No groups yet.</p>
        ) : null}
      </div>
    </section>
  );
}
