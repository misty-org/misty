import {
  compareApplyTextMerge,
  compareFiles,
  compareFolders,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
} from "@/features/files/native";
import { SystemErrorActivity } from "@/features/activity";
import { useExplorerStore, useOperationQueueStore } from "../store";
import {
  loadCompareImagePreview,
  loadCompareTextDiff,
} from "./compareDialog/comparePreview";
import {
  CompareDialogView,
  type CompareDialogRuntime,
} from "./ExplorerCompareDialogView";
import type { CompareDialogSeed } from "../model/interfaces/workspace/ExplorerCompareDialog";
export type * from "../model/interfaces/workspace/ExplorerCompareDialog";
export type * from "../model/types/workspace/ExplorerCompareDialog";
const runtime: CompareDialogRuntime = {
  compareFiles,
  compareFolders,
  merge: compareApplyTextMerge,
  textDiff: loadCompareTextDiff,
  images: loadCompareImagePreview,
  async copy(source, destinationDirectory) {
    await explorerQueuePasteItems({
      sources: [{ path: source, isDirectory: false }],
      destinationDirectory,
      operation: "copy",
    });
    void useOperationQueueStore.getState().load({ silent: true });
  },
  async trash(path) {
    await explorerQueueDeleteItems({ paths: [path], permanent: false });
    void useOperationQueueStore.getState().load({ silent: true });
  },
  notify: (message) =>
    useExplorerStore.getState().pushNotification(message, "success", 3500),
  Error: ({ error }) => (
    <SystemErrorActivity
      error={error}
      scope="files:compare"
      title="File comparison could not be completed"
      target={{ kind: "workspace-tool", tool: "files" }}
    />
  ),
};
export function CompareDialog(props: {
  seed: CompareDialogSeed;
  onClose(): void;
}) {
  return <CompareDialogView {...props} runtime={runtime} />;
}
