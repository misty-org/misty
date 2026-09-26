import type { StoreApi } from "zustand";
import type {
  ExplorerBatchRenameItem,
  ExplorerInlineEditState,
  PaneExplorerState,
} from "./explorer/model/interfaces/store/types";
import type { ExplorerDialogState } from "./explorer/model/types/store/types";
import {
  splitRenameParts,
  validateBatchRenameItems,
  withInlineEditValidation,
  renameTargetPath,
} from "./explorer/utils/inlineEdit";
import type { SdkFilesDirectory } from "./sdkFilesDirectory";

export interface SdkFilesEditingState {
  pane: PaneExplorerState;
  inlineEdit: ExplorerInlineEditState | null;
  dialog: ExplorerDialogState;
}

/** Editing belongs to the mounted view and retains failed drafts for retry. */
export function createSdkFilesEditing<State extends SdkFilesEditingState>(options: {
  store: StoreApi<State>;
  owner: (path: string) => SdkFilesDirectory;
  perform: <T>(operation: () => Promise<T>) => Promise<T>;
  assert: () => void;
}) {
  const { store, owner, perform, assert } = options;
  const set = (state: Partial<SdkFilesEditingState>) => store.setState(state as Partial<State>);
  let session = 0;
  let committing: { session: number; promise: Promise<void> } | undefined;
  const writable = () => {
    assert();
    const pane = store.getState().pane;
    if (!pane.listing) throw new Error("Choose a folder first.");
    if (!owner(pane.listing.path).writable)
      throw new Error("Choose this folder with write access to edit it.");
    return pane;
  };
  const cancelInlineEdit = () => {
    assert();
    session++;
    set({ inlineEdit: null });
  };
  function startInlineCreate(kind: "file" | "folder", paneId = "files") {
    const pane = writable();
    const base = kind === "folder" ? "New Folder" : "New File";
    let name = base;
    for (let index = 2; pane.listing!.entries.some((entry) => entry.name === name); index++)
      name = `${base} ${index}`;
    session++;
    set({
      dialog: null,
      inlineEdit: {
        paneId,
        kind: "create",
        itemKind: kind,
        entryId: null,
        originalName: "",
        value: name,
        lockedExtension: "",
        error: null,
      },
    });
  }
  function startInlineRename(paneId = "files", batch = false) {
    const pane = writable();
    const entries = pane.listing!.entries.filter((entry) => pane.selectedIds.includes(entry.id));
    if (!entries.length) return;
    if (entries.some((entry) => entry.readonly))
      throw new Error("The selection contains a read-only item.");
    const items: ExplorerBatchRenameItem[] = entries.map((entry) => {
      const [value, lockedExtension] = splitRenameParts(entry);
      return {
        paneId,
        entryId: entry.id,
        path: entry.path,
        directoryPath: pane.listing!.path,
        originalName: entry.name,
        value,
        lockedExtension,
        isDirectory: entry.kind === "folder",
        siblingNames: pane
          .listing!.entries.filter((other) => other.id !== entry.id)
          .map((other) => other.name),
        error: null,
      };
    });
    session++;
    if (batch || items.length > 1) {
      set({ inlineEdit: null, dialog: { kind: "batchRename", paneId, items } });
      return;
    }
    const item = items[0];
    set({
      dialog: null,
      inlineEdit: {
        paneId,
        kind: "rename",
        itemKind: item.isDirectory ? "folder" : "file",
        entryId: item.entryId,
        originalName: item.originalName,
        value: item.value,
        lockedExtension: item.lockedExtension,
        error: null,
      },
    });
  }
  function updateInlineEdit(value: string) {
    assert();
    const { inlineEdit, pane } = store.getState();
    if (!inlineEdit || committing?.session === session) return;
    set({ inlineEdit: withInlineEditValidation({ ...inlineEdit, value }, pane) });
  }
  function commitInlineEdit(): Promise<void> {
    assert();
    if (committing?.session === session) return committing.promise;
    const { inlineEdit, pane } = store.getState();
    if (!inlineEdit || !pane.listing) return Promise.resolve();
    const edit = withInlineEditValidation(inlineEdit, pane);
    set({ inlineEdit: edit });
    if (edit.error) return Promise.resolve();
    const name = `${edit.value}${edit.lockedExtension}`;
    if (edit.kind === "rename" && name === edit.originalName) {
      cancelInlineEdit();
      return Promise.resolve();
    }
    const path = pane.listing.path,
      folder = owner(path),
      currentSession = session;
    const pending = perform(async () => {
      if (edit.kind === "create")
        await folder.create({ directory: path, name, kind: edit.itemKind });
      else await folder.rename({ path: edit.entryId!, newName: name });
      // A successful mutation must not be retried if refreshing the listing fails.
      if (session === currentSession) set({ inlineEdit: null });
    })
      .catch((cause) => {
        if (session === currentSession && store.getState().inlineEdit === edit)
          set({
            inlineEdit: { ...edit, error: cause instanceof Error ? cause.message : String(cause) },
          });
        throw cause;
      })
      .finally(() => {
        if (committing?.session === currentSession) committing = undefined;
      });
    committing = { session: currentSession, promise: pending };
    return pending;
  }
  function closeDialog() {
    assert();
    session++;
    set({ dialog: null });
  }
  function applyBatchRename(items: ExplorerBatchRenameItem[]): Promise<void> {
    assert();
    if (committing?.session === session) return committing.promise;
    const dialog = store.getState().dialog;
    if (dialog?.kind !== "batchRename") return Promise.resolve();
    // The UI may change names, never the source paths or the folder grants.
    const validated = validateBatchRenameItems(
      dialog.items.map((original) => {
        const proposal = items.find(
          (item) => item.entryId === original.entryId && item.paneId === original.paneId,
        );
        return proposal
          ? { ...original, value: proposal.value, lockedExtension: proposal.lockedExtension }
          : original;
      }),
    );
    set({ dialog: { ...dialog, items: validated } });
    if (validated.some((item) => item.error)) return Promise.resolve();
    const currentSession = session;
    const pending = perform(async () => {
      for (let index = 0; index < validated.length; index++) {
        const item = validated[index],
          name = `${item.value}${item.lockedExtension}`;
        if (name === item.originalName) continue;
        try {
          await owner(item.path).rename({ path: item.path, newName: name });
          const path = renameTargetPath(item.directoryPath, name);
          validated[index] = { ...item, path, entryId: path, originalName: name };
          for (const sibling of validated) {
            if (sibling.directoryPath === item.directoryPath)
              sibling.siblingNames = sibling.siblingNames.map((old) =>
                old === item.originalName ? name : old,
              );
          }
        } catch (cause) {
          validated[index] = {
            ...item,
            error: cause instanceof Error ? cause.message : String(cause),
          };
          if (session === currentSession) set({ dialog: { ...dialog, items: [...validated] } });
          throw cause;
        }
      }
      if (session === currentSession) set({ dialog: null });
    }).finally(() => {
      if (committing?.session === currentSession) committing = undefined;
    });
    committing = { session: currentSession, promise: pending };
    return pending;
  }
  const invalidate = () => {
    session++;
  };
  return {
    invalidate,
    startInlineCreate,
    startInlineRename,
    startBatchRename: (paneId = "files") => startInlineRename(paneId, true),
    updateInlineEdit,
    commitInlineEdit,
    cancelInlineEdit,
    closeDialog,
    applyBatchRename,
  };
}
