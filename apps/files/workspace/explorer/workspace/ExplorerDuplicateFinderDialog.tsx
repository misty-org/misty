import { useMemo } from "react";
import { useTransfersStore } from "@/features/transfers";
import { SystemErrorActivity } from "@/features/activity";
import {
  duplicatesCancel,
  duplicatesHashRemoteCandidates,
  duplicatesScan,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
} from "@/features/files/native";
import { useExplorerStore, useOperationQueueStore } from "../store";
import {
  DuplicateFinderDialogView,
  type DuplicateFinderRuntime,
} from "./ExplorerDuplicateFinderDialogView";
export function DuplicateFinderDialog(props: {
  paneId: string;
  defaultRoot: string;
  onClose(): void;
}) {
  const runtime = useMemo<DuplicateFinderRuntime>(() => {
    let scanId: string | undefined;
    let remote = new Set<string>();
    const retain = (result: Awaited<ReturnType<typeof duplicatesScan>>) => {
      scanId = result.scanId;
      remote = new Set(
        result.groups.flatMap((group) =>
          group.items.filter((item) => item.remote).map((item) => item.path),
        ),
      );
      return result;
    };
    return {
      scan: async (request) => retain(await duplicatesScan(request)),
      cancel: async (id = scanId) => {
        if (id) await duplicatesCancel(id);
      },
      hashRemote: async (id) =>
        retain(await duplicatesHashRemoteCandidates(id)),
      async cleanup(paths, mode, destinationDirectory) {
        if (mode === "move") {
          for (const selected of [
            paths.filter((path) => !remote.has(path)),
            paths.filter((path) => remote.has(path)),
          ])
            if (selected.length)
              await explorerQueuePasteItems({
                sources: selected.map((path) => ({ path, isDirectory: false })),
                destinationDirectory,
                operation: "move",
              });
        } else await explorerQueueDeleteItems({ paths, permanent: false });
        void useTransfersStore.getState().load(undefined, { silent: true });
        void useOperationQueueStore.getState().load({ silent: true });
        useExplorerStore
          .getState()
          .pushNotification(
            `Queued ${mode} cleanup for ${paths.length} items`,
            "success",
          );
        void useExplorerStore.getState().refreshPane(props.paneId);
      },
      Error: ({ error }) => (
        <SystemErrorActivity
          error={error}
          scope="files:duplicates"
          title="Duplicate scan could not be completed"
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      ),
    };
  }, [props.paneId]);
  return <DuplicateFinderDialogView {...props} runtime={runtime} />;
}
