import type { FormEvent } from "react";
import type { SpaceLibraryData } from "../types/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "../types/useSpaceLibraryItemActions";

/** The one-field prompt shared by item renames and tag edits. */
export function useLibraryTextDialog(options: {
  data: SpaceLibraryData;
  updateItem: SpaceLibraryItemActions["updateItem"];
}) {
  const { data, updateItem } = options;
  const { canEditLibrary, items } = data;
  const { textDialog, setTextDialog, textDialogSaving, setTextDialogSaving, setTextDialogError } =
    data;

  const submitTextDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEditLibrary || !textDialog || textDialogSaving) return;
    const primaryValue = textDialog.primaryValue.trim();
    if (textDialog.kind !== "edit-tags" && !primaryValue) return;

    setTextDialogSaving(true);
    setTextDialogError("");
    try {
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
      setTextDialog(null);
    } catch (error) {
      setTextDialogError(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      setTextDialogSaving(false);
    }
  };

  return { submitTextDialog };
}
