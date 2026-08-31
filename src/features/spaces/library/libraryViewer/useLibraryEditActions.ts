import { spacesApi } from "@/api/spaces/api";
import type { LibraryEditVersion, SpaceLibraryItem } from "@/api/spaces/dto/interfaces/types";
import type { LibraryEditDefinition } from "@/api/spaces/dto/types/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useState, type Dispatch, type SetStateAction } from "react";
import { normalizeLibraryEdit } from "../SpaceLibraryViewerUtils";

export interface LibraryEditActionsOptions {
  spaceId: string;
  item: SpaceLibraryItem;
  reauthenticationToken: string;
  canEdit: boolean;
  isImage: boolean;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  editVersions: LibraryEditVersion[];
  setEditVersions: Dispatch<SetStateAction<LibraryEditVersion[]>>;
  editDraft: LibraryEditDefinition;
  setEditDraft: Dispatch<SetStateAction<LibraryEditDefinition>>;
  onReplaceItem: (item: SpaceLibraryItem) => void;
  onRenditionReady: () => void;
}

/** Every server-side mutation of an item's edit versions, with shared busy/error state. */
export function useLibraryEditActions(options: LibraryEditActionsOptions) {
  const { spaceId, item, reauthenticationToken, canEdit, isImage, editing } = options;
  const { setEditing, editVersions, setEditVersions, editDraft, setEditDraft } = options;
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const run = async (action: () => Promise<void>, fallbackMessage: string) => {
    if (!canEdit || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      await action();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      setEditSaving(false);
    }
  };

  const saveEdit = (definition: LibraryEditDefinition = editDraft) =>
    run(async () => {
      const result = await spacesApi.createEditVersion(
        spaceId,
        item,
        definition,
        reauthenticationToken,
      );
      options.onReplaceItem(result.item);
      if (result.edit) await startRendition({ ...result.edit, is_current: true });
      setEditing(false);
    }, "Edit could not be saved.");

  const startRendition = async (savedVersion: LibraryEditVersion) => {
    setEditVersions((current) => [
      savedVersion,
      ...current.map((version) => ({ ...version, is_current: false })),
    ]);
    try {
      const rendition = await spacesApi.renderEditVersion(
        spaceId,
        item.id,
        savedVersion.id,
        0,
        reauthenticationToken,
      );
      setEditVersions((current) =>
        current.map((version) =>
          version.id === savedVersion.id
            ? { ...version, rendition_state: rendition.state }
            : version,
        ),
      );
    } catch (error) {
      setEditError(
        error instanceof Error
          ? `The edit was saved, but its media rendition could not start: ${error.message}`
          : "The edit was saved, but its media rendition could not start.",
      );
    }
  };

  const saveAsCopy = (definition: LibraryEditDefinition = editDraft) =>
    run(async () => {
      const duplicated = await spacesApi.duplicateLibraryItems(
        spaceId,
        [item.id],
        reauthenticationToken,
      );
      const copy = duplicated.items[0];
      if ((isImage || editing) && copy) {
        const edited = await spacesApi.createEditVersion(
          spaceId,
          copy,
          definition,
          reauthenticationToken,
        );
        if (edited.edit)
          await spacesApi.renderEditVersion(
            spaceId,
            copy.id,
            edited.edit.id,
            0,
            reauthenticationToken,
          );
      }
      options.onRenditionReady();
    }, "A copy could not be saved.");

  const renderEdit = (editID: string) =>
    run(async () => {
      const rendition = await spacesApi.renderEditVersion(
        spaceId,
        item.id,
        editID,
        0,
        reauthenticationToken,
      );
      setEditVersions((current) =>
        current.map((version) =>
          version.id === editID
            ? { ...version, rendition_state: rendition.state, rendition_error_code: undefined }
            : version,
        ),
      );
    }, "The edit rendition could not start.");

  const selectEdit = (editID = "") =>
    run(async () => {
      const result = await spacesApi.selectEditVersion(
        spaceId,
        item,
        editID,
        reauthenticationToken,
      );
      options.onReplaceItem(result.item);
      setEditVersions((current) =>
        current.map((version) => ({ ...version, is_current: version.id === editID })),
      );
      setEditDraft(
        normalizeLibraryEdit(
          editVersions.find((version) => version.id === editID)?.edit_definition,
        ),
      );
      setEditing(false);
    }, "Version could not be selected.");

  const deleteEdit = async (editID: string) => {
    if (!canEdit || editSaving || !(await confirmAction("Delete this edit version?"))) return;
    await run(async () => {
      await spacesApi.deleteEditVersion(spaceId, item.id, editID, reauthenticationToken);
      setEditVersions((current) => current.filter((version) => version.id !== editID));
    }, "Version could not be deleted.");
  };

  return {
    editSaving,
    editError,
    setEditError,
    saveEdit,
    saveAsCopy,
    renderEdit,
    selectEdit,
    deleteEdit,
  };
}
