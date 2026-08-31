import { spacesApi } from "@/api/spaces/api";
import type { FormEvent } from "react";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "../types/useSpaceLibraryItemActions";
import type { UpdateMemoryPatch } from "./useLibraryMaintenance";

/**
 * The one-field prompt shared by folder, memory and item renames.
 *
 * Each `kind` decides which API the submitted value goes to, which keeps the
 * Library from needing four near-identical dialogs.
 */
export function useLibraryTextDialog(options: {
  data: SpaceLibraryData;
  updateItem: SpaceLibraryItemActions["updateItem"];
  updateCurrentMemory: (patch: UpdateMemoryPatch) => Promise<unknown>;
}) {
  const { data, updateItem, updateCurrentMemory } = options;
  const { spaceId, canEditLibrary, items, albumFolders, setAlbumFolders } = data;
  const { selectedAlbumFolderId, setSelectedAlbumFolderId } = data;
  const { textDialog, setTextDialog, textDialogSaving, setTextDialogSaving, setTextDialogError } =
    data;

  const submitTextDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditLibrary || !textDialog || textDialogSaving) return;
    const primaryValue = textDialog.primaryValue.trim();
    const secondaryValue = textDialog.secondaryValue?.trim() ?? "";
    if (
      (textDialog.kind !== "edit-tags" && !primaryValue) ||
      (textDialog.secondaryLabel && !secondaryValue)
    )
      return;

    setTextDialogSaving(true);
    setTextDialogError("");
    try {
      if (textDialog.kind === "create-folder") {
        const folder = await spacesApi.createAlbumFolder(
          spaceId,
          primaryValue,
          selectedAlbumFolderId,
        );
        setAlbumFolders((current) =>
          [...current, folder].sort(
            (a, b) => a.position - b.position || a.name.localeCompare(b.name),
          ),
        );
        setSelectedAlbumFolderId(folder.id);
      } else if (textDialog.kind === "rename-folder") {
        const folder = albumFolders.find((candidate) => candidate.id === selectedAlbumFolderId);
        if (!folder) throw new Error("This album folder is no longer available.");
        const saved = await spacesApi.updateAlbumFolder(spaceId, folder, { name: primaryValue });
        setAlbumFolders((current) =>
          current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
        );
      } else if (textDialog.kind === "rename-memory") {
        if (!(await updateCurrentMemory({ title: primaryValue })))
          throw new Error("The memory could not be renamed.");
      } else {
        const item = items.find((candidate) => candidate.id === textDialog.itemId);
        if (!item) throw new Error("This Library item is no longer available.");
        const updated =
          textDialog.kind === "rename-item"
            ? await updateItem(item, { display_name: primaryValue })
            : await updateItem(item, {
                tags: primaryValue
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              });
        if (!updated) throw new Error("The Library item could not be updated.");
      }
      setTextDialog(null);
    } catch (error) {
      setTextDialogError(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      setTextDialogSaving(false);
    }
  };

  return { submitTextDialog };
}
