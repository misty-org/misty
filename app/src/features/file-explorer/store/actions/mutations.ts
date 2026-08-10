import { selectGeneralPreferences, useSettingsStore } from "@/features/settings";
import {
  explorerQueueCreateItem,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  explorerQueueRenameItem,
  explorerQueueRenameItems,
} from "@/services/backend";
import { userFacingErrorText } from "@/shared/lib/format";
import type { ExplorerInlineEditState, ExplorerStore } from "../../model/interfaces/store/types";
import type { ExplorerGet, ExplorerSet } from "../../model/types/store/types";
import * as H from "../helpers";

export function createMutationsActions(set: ExplorerSet, get: ExplorerGet): Partial<ExplorerStore> {
  return {
    canCreateItem: (paneId, kind) =>
      H.canCreateItemInPane(get().panes[paneId], kind, get().inlineEdit),

    createItem: async (paneId, kind, name) => {
      const pane = get().panes[paneId];
      const directory = pane?.listing?.path;
      if (!directory) return;
      const defaultName = kind === "folder" ? "Untitled Folder" : "Untitled File";
      if (name == null) {
        if (!H.canCreateItemInPane(pane, kind, get().inlineEdit)) return;
        const inlineEdit: ExplorerInlineEditState = {
          paneId,
          kind: "create",
          itemKind: kind,
          entryId: null,
          originalName: "",
          value: defaultName,
          lockedExtension: "",
          error: null,
        };
        set({ inlineEdit: H.withInlineEditValidation(inlineEdit, pane) });
        return;
      }
      const inlineEdit = get().inlineEdit;
      const submittingCurrentCreate =
        inlineEdit?.kind === "create" &&
        inlineEdit.paneId === paneId &&
        inlineEdit.itemKind === kind;
      if (!H.canCreateItemInPane(pane, kind, submittingCurrentCreate ? null : inlineEdit)) return;
      const requestedName = name;
      if (!requestedName) return;
      try {
        set({ operationError: null });
        await explorerQueueCreateItem({ directory, name: requestedName, kind });
        H.refreshTransferViews();
        get().pushNotification(
          `Queued ${kind === "folder" ? "folder" : "file"} creation`,
          "success",
        );
        H.queuePaneRefresh(paneId, directory);
      } catch (error) {
        set({ operationError: userFacingErrorText(error) });
      }
    },

    renameSelected: async (paneId, name) => {
      const pane = get().panes[paneId];
      const entries = H.selectedEntriesForPane(pane);
      const entry = entries[0] ?? null;
      if (name == null) {
        const renameItems = H.selectedBatchRenameItemsAcrossPanes(get().panes, paneId);
        if (renameItems.length === 0) return;
        const targetItem = renameItems[0];
        const targetPaneId = targetItem?.paneId ?? paneId;
        const targetPane = get().panes[targetPaneId] ?? pane;
        const targetEntry =
          targetPane?.listing?.entries.find((candidate) => candidate.id === targetItem?.entryId) ??
          entry;
        const [value, lockedExtension] = H.splitRenameParts(targetEntry);
        const inlineEdit: ExplorerInlineEditState = {
          paneId: targetPaneId,
          kind: "rename",
          itemKind: targetEntry.kind === "folder" ? "folder" : "file",
          entryId: targetEntry.id,
          originalName: targetEntry.name,
          value,
          lockedExtension,
          batchItems: renameItems.length > 1 ? renameItems : undefined,
          error: null,
        };
        set({ inlineEdit: H.withInlineEditValidation(inlineEdit, targetPane) });
        return;
      }
      if (!entry) return;
      const requestedName = name;
      if (!requestedName || requestedName === entry.name) return;
      try {
        set({ operationError: null });
        await explorerQueueRenameItem({
          path: entry.path,
          newName: requestedName,
          sourceIsDirectory: entry.kind === "folder",
        });
        H.refreshTransferViews();
        get().pushNotification(`Queued rename to ${requestedName}`, "success");
        get().clearSelection(paneId);
        H.queuePaneRefresh(paneId, pane?.listing?.path ?? entry.path);
      } catch (error) {
        set({ operationError: userFacingErrorText(error) });
      }
    },

    openBatchRenameDialog: (paneId) => {
      const items = H.selectedBatchRenameItemsAcrossPanes(get().panes, paneId);
      if (items.length === 0) return;
      set({
        inlineEdit: null,
        dialog: {
          kind: "batchRename",
          paneId,
          items: H.validateBatchRenameItems(items),
        },
      });
    },

    deleteSelected: async (paneId, mode) => {
      const pane = get().panes[paneId];
      const permanent = H.deleteModeForPaneSelection(pane, mode) === "permanent";
      const paths = H.selectedDeletePathsForPane(pane, permanent);
      if (paths.length === 0) return;
      const isTrashPane = pane?.listing?.path === "misty://trash";
      const shouldConfirm =
        permanent &&
        !isTrashPane &&
        selectGeneralPreferences(useSettingsStore.getState().settings?.document)
          .confirmDestructiveActions;
      if (!shouldConfirm) {
        try {
          set({ operationError: null });
          const directory = pane?.listing?.path;
          await explorerQueueDeleteItems({ paths, permanent });
          H.refreshTransferViews();
          get().pushNotification(H.deleteQueuedMessage(paths.length, permanent), "success");
          get().clearSelection(paneId);
          if (directory) H.queuePaneRefresh(paneId, directory);
        } catch (error) {
          set({ operationError: userFacingErrorText(error) });
        }
        return;
      }
      set({ dialog: { kind: "delete", paneId, paths, permanent } });
    },

    downloadSelected: async (paneId) => {
      const pane = get().panes[paneId];
      const items = H.selectedRemotePasteItemsForPane(pane);
      if (items.length === 0) return;
      try {
        const downloadsDirectory = await H.downloadDestinationDirectory();
        if (!downloadsDirectory) return;
        set({ operationError: null });
        await explorerQueuePasteItems({
          sources: items,
          destinationDirectory: downloadsDirectory,
          operation: "copy",
        });
        H.refreshTransferViews();
        get().pushNotification(`Queued download for ${H.itemCountLabel(items.length)}`, "success");
        if (pane?.listing && H.samePath(pane.listing.path, downloadsDirectory)) {
          H.queuePaneRefresh(paneId, downloadsDirectory);
        }
      } catch (error) {
        set({ operationError: `Download failed: ${userFacingErrorText(error)}` });
      }
    },

    confirmDialog: async () => {
      const dialog = get().dialog;
      if (!dialog) return;
      if (dialog.kind === "delete") {
        set({ dialog: null });
        try {
          set({ operationError: null });
          const directory = get().panes[dialog.paneId]?.listing?.path;
          await explorerQueueDeleteItems({ paths: dialog.paths, permanent: dialog.permanent });
          H.refreshTransferViews();
          get().pushNotification(
            H.deleteQueuedMessage(dialog.paths.length, dialog.permanent),
            "success",
          );
          get().clearSelection(dialog.paneId);
          if (directory) H.queuePaneRefresh(dialog.paneId, directory);
        } catch (error) {
          set({ operationError: userFacingErrorText(error) });
        }
        return;
      }

      const validatedItems = H.validateBatchRenameItems(dialog.items);
      const items = validatedItems
        .map((item) => ({
          item,
          effectiveName: `${item.value.trim()}${item.lockedExtension}`,
        }))
        .filter(({ item, effectiveName }) => !item.error && effectiveName !== item.originalName)
        .map(({ item, effectiveName }) => ({
          path: item.path,
          newName: effectiveName,
          sourceIsDirectory: item.isDirectory,
        }));
      if (items.length === 0) {
        const hasErrors = validatedItems.some((item) => item.error);
        set(hasErrors ? { dialog: { ...dialog, items: validatedItems } } : { dialog: null });
        return;
      }
      set({ dialog: null });
      try {
        set({ operationError: null });
        await explorerQueueRenameItems({ items });
        H.refreshTransferViews();
        get().pushNotification(`Queued rename for ${H.itemCountLabel(items.length)}`, "success");
        H.refreshAndClearRenamePanes(validatedItems);
      } catch (error) {
        set({
          operationError: userFacingErrorText(error),
          dialog: { ...dialog, items: validatedItems },
        });
      }
    },

    setInlineEditValue: (value) =>
      set((state) => {
        if (!state.inlineEdit) return state;
        const draft = { ...state.inlineEdit, value };
        return {
          inlineEdit: H.withInlineEditValidation(draft, state.panes[draft.paneId]),
        };
      }),

    setBatchRenameValue: (paneId, entryId, value) =>
      set((state) => {
        const dialog = state.dialog;
        if (dialog?.kind !== "batchRename") return state;
        const items = H.validateBatchRenameItems(
          dialog.items.map((item) =>
            item.paneId === paneId && item.entryId === entryId ? { ...item, value } : item,
          ),
        );
        return { dialog: { ...dialog, items } };
      }),

    setBatchRenameItems: (paneId, items) =>
      set((state) => {
        const dialog = state.dialog;
        if (dialog?.kind !== "batchRename" || dialog.paneId !== paneId) return state;
        return { dialog: { ...dialog, items: H.validateBatchRenameItems(items) } };
      }),

    commitInlineEdit: async () => {
      const edit = get().inlineEdit;
      if (!edit) return;
      const pane = get().panes[edit.paneId];
      const validated = H.withInlineEditValidation(edit, pane);
      const batchRename =
        validated.kind === "rename" && validated.batchItems && validated.batchItems.length > 1;
      if (validated.error && !batchRename) {
        set({ inlineEdit: validated });
        get().pushNotification(validated.error, "error", 4500);
        return;
      }
      const effectiveName = `${validated.value.trim()}${validated.lockedExtension}`;
      if (validated.kind === "rename" && !batchRename && effectiveName === validated.originalName) {
        set({ inlineEdit: null });
        return;
      }
      if (validated.kind === "create") {
        await get().createItem(validated.paneId, validated.itemKind, effectiveName);
      } else if (validated.batchItems && validated.batchItems.length > 1) {
        set({
          inlineEdit: null,
          dialog: {
            kind: "batchRename",
            paneId: validated.paneId,
            items: H.validateBatchRenameItems(validated.batchItems),
          },
        });
        return;
      } else {
        await get().renameSelected(validated.paneId, effectiveName);
      }
      const operationError = get().operationError;
      if (operationError && get().inlineEdit === edit) {
        set({ inlineEdit: { ...validated, error: operationError } });
      } else if (get().inlineEdit === edit) {
        set({ inlineEdit: null });
      }
    },

    cancelInlineEdit: () => set((state) => (state.inlineEdit ? { inlineEdit: null } : state)),

    closeDialog: () =>
      set((state) => {
        const dialog = state.dialog;
        if (!dialog) return state;
        if (dialog.kind !== "batchRename") return { dialog: null };
        return {
          dialog: null,
          inlineEdit: H.inlineEditFromBatchRenameDialog(dialog),
        };
      }),
  };
}
