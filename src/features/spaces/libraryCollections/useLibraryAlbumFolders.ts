import { confirmAction } from "@/lib/confirmAction";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceLibraryData } from "@/models/types/features/spaces/useSpaceLibraryData";

/**
 * Album folders. Create and rename go through the shared text dialog, so those
 * two only open it — the actual write happens in `useLibraryTextDialog`.
 */
export function useLibraryAlbumFolders(data: SpaceLibraryData) {
  const { spaceId, canEditLibrary, albumFolders, setAlbumFolders, setAlbums } = data;
  const { selectedAlbumFolderId, setSelectedAlbumFolderId, showTextDialog, setLocalError } = data;

  const currentFolder = () =>
    albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);

  const createAlbumFolder = () => {
    if (!canEditLibrary) return;
    showTextDialog({
      kind: "create-folder",
      title: "New album folder",
      primaryLabel: "Folder name",
      primaryValue: "",
    });
  };

  const renameAlbumFolder = () => {
    if (!canEditLibrary) return;
    const folder = currentFolder();
    if (!folder) return;
    showTextDialog({
      kind: "rename-folder",
      title: "Rename album folder",
      primaryLabel: "Folder name",
      primaryValue: folder.name,
    });
  };

  const deleteAlbumFolder = async () => {
    if (!canEditLibrary) return;
    const folder = currentFolder();
    if (
      !folder ||
      !(await confirmAction(`Delete “${folder.name}”? Albums will move to the top level.`))
    )
      return;
    try {
      await spacesApi.deleteAlbumFolder(spaceId, folder);
      setAlbumFolders((current) =>
        current.filter(
          (candidate) => candidate.id !== folder.id && candidate.parent_folder_id !== folder.id,
        ),
      );
      setAlbums((current) =>
        current.map((album) =>
          album.folder_id === folder.id ? { ...album, folder_id: undefined } : album,
        ),
      );
      setSelectedAlbumFolderId(folder.parent_folder_id ?? "");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album folder could not be deleted.");
    }
  };

  return { createAlbumFolder, renameAlbumFolder, deleteAlbumFolder };
}
