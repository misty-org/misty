import { spacesApi } from "@/api/spaces/api";
import { confirmAction } from "@/shared/lib/confirmAction";
import type { FormEvent } from "react";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";
import type { SelectCollection } from "./useLibraryCollectionRoute";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Album creation, editing, deletion and drag-to-reorder. */
export function useLibraryAlbums(data: SpaceLibraryData, selectCollection: SelectCollection) {
  const { spaceId, canEditLibrary, currentAlbum, setAlbums, setLocalError } = data;
  const { albumDialogMode, setAlbumDialogMode, albumName, setAlbumName } = data;
  const { albumDescription, setAlbumDescription, albumCoverItemId, setAlbumCoverItemId } = data;
  const { albumSaving, setAlbumSaving, selectedAlbumFolderId } = data;
  const { visibleItems, setVisibleItems, setItems, setReloadKey } = data;
  const { canReorderAlbum, draggedAlbumItemId, setDraggedAlbumItemId } = data;

  const openCreateAlbum = () => {
    if (!canEditLibrary) return;
    setAlbumName("");
    setAlbumDescription("");
    setAlbumCoverItemId("");
    setAlbumDialogMode("create");
  };

  const openEditAlbum = () => {
    if (!canEditLibrary || !currentAlbum) return;
    setAlbumName(currentAlbum.name);
    setAlbumDescription(currentAlbum.description);
    setAlbumCoverItemId(currentAlbum.cover_item_id ?? "");
    setAlbumDialogMode("edit");
  };

  const saveAlbum = async (event: FormEvent) => {
    event.preventDefault();
    const name = albumName.trim();
    if (!canEditLibrary || !name || albumSaving) return;
    setAlbumSaving(true);
    try {
      if (albumDialogMode === "edit" && currentAlbum) {
        const saved = await spacesApi.updateAlbum(spaceId, currentAlbum, {
          name,
          description: albumDescription.trim(),
          cover_item_id: albumCoverItemId,
        });
        setAlbums((current) =>
          current.map((album) => (album.id === saved.id ? saved : album)).sort(byName),
        );
      } else {
        let album = await spacesApi.createAlbum(spaceId, name, albumDescription.trim());
        if (selectedAlbumFolderId)
          album = await spacesApi.organizeAlbum(spaceId, album, {
            folder_id: selectedAlbumFolderId,
          });
        setAlbums((current) => [...current, album].sort(byName));
        selectCollection("albums", album.id);
      }
      setAlbumDialogMode("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album could not be saved.");
    } finally {
      setAlbumSaving(false);
    }
  };

  const deleteCurrentAlbum = async () => {
    if (
      !canEditLibrary ||
      !currentAlbum ||
      !(await confirmAction(
        `Delete “${currentAlbum.name}”? Its Library items will not be deleted.`,
      ))
    )
      return;
    try {
      await spacesApi.deleteAlbum(spaceId, currentAlbum);
      setAlbums((current) => current.filter((album) => album.id !== currentAlbum.id));
      selectCollection("collections");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album could not be deleted.");
    }
  };

  /** Reorders locally first; a failed save forces a reload rather than guessing. */
  const reorderAlbumItem = async (targetItemId: string, movingItemId = draggedAlbumItemId) => {
    if (
      !canEditLibrary ||
      !currentAlbum ||
      !canReorderAlbum ||
      !movingItemId ||
      movingItemId === targetItemId
    )
      return;
    const nextItems = [...visibleItems];
    const from = nextItems.findIndex((item) => item.id === movingItemId);
    const to = nextItems.findIndex((item) => item.id === targetItemId);
    if (from < 0 || to < 0) return;
    const [moved] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, moved);
    setItems(nextItems);
    setVisibleItems(nextItems);
    setDraggedAlbumItemId("");
    try {
      const saved = await spacesApi.reorderAlbumItems(
        spaceId,
        currentAlbum,
        nextItems.map((item) => item.id),
      );
      setAlbums((current) => current.map((album) => (album.id === saved.id ? saved : album)));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Album order could not be saved.");
      setReloadKey((current) => current + 1);
    }
  };

  return { openCreateAlbum, openEditAlbum, saveAlbum, deleteCurrentAlbum, reorderAlbumItem };
}
