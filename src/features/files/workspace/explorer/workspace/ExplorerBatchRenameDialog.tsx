import { ExplorerDeleteDialogView } from "./ExplorerDeleteDialogView";
import { useExplorerStore } from "../store";
import { BatchRenameDialogView } from "./BatchRenameDialogView";
export type { BatchRenameCaseMode, BatchRenameOptions } from "./BatchRenameDialogView";

export function ExplorerDialog() {
  const dialog = useExplorerStore((state) => state.dialog);
  if (!dialog) return null;
  if (dialog.kind === "batchRename") {
    return (
      <BatchRenameDialogView
        dialog={dialog}
        onClose={() => useExplorerStore.getState().closeDialog()}
        onApply={async (items) => {
          const store = useExplorerStore.getState();
          store.setBatchRenameItems(dialog.paneId, items);
          await store.confirmDialog();
        }}
      />
    );
  }
  return (
    <ExplorerDeleteDialogView
      paths={dialog.paths}
      onClose={() => useExplorerStore.getState().closeDialog()}
      onConfirm={() => useExplorerStore.getState().confirmDialog()}
    />
  );
}
