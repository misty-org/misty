import { transferDropAcceptance } from "@/features/explorer/components/FileBrowserDrag";
import { Droppable } from "@/features/explorer/drag/ExplorerDragContext";
import { groupItemsByOperation, storageIdForPath } from "@/features/explorer/drag/operations";
import { useMemo, type ReactNode } from "react";
import {
  explorerPathIsDirectory,
  explorerPrepareDragItems,
  explorerQueueDeleteItems,
} from "@/stores/backend";
import { useMultiPanelStore } from "@/features/workspace";
import { useExplorerStore } from "@/stores/explorer";
import { useSmartLibraryStore } from "@/stores/media/useSmartLibraryStore";
import type {
  ExplorerDragModifiers,
  ExplorerDragPayload,
  ExplorerDropZoneSpec,
} from "@/models/interfaces/features/explorer/drag/types";

export function ExplorerDropTarget(props: {
  id: string;
  path: string;
  kind?: TargetKind;
  paneId?: string;
  remoteName?: string | null;
  springLoad?: boolean;
  onSpringLoad?: () => void;
  children: ReactNode;
}) {
  const kind = props.kind ?? dropKindForPath(props.path);
  const zone = useMemo<ExplorerDropZoneSpec>(
    () =>
      createExplorerDropTargetSpec({
        id: props.id,
        path: props.path,
        kind,
        paneId: props.paneId,
        remoteName: props.remoteName,
        onSpringLoad: props.onSpringLoad,
        springLoad: props.springLoad,
      }),
    [
      kind,
      props.id,
      props.onSpringLoad,
      props.paneId,
      props.path,
      props.remoteName,
      props.springLoad,
    ],
  );
  return (
    <Droppable className="contents" zone={zone}>
      {props.children}
    </Droppable>
  );
}

export function createExplorerDropTargetSpec(options: {
  id: string;
  path: string;
  kind?: TargetKind;
  paneId?: string;
  remoteName?: string | null;
  springLoad?: boolean;
  onSpringLoad?: () => void;
}): ExplorerDropZoneSpec {
  const kind = options.kind ?? dropKindForPath(options.path);
  return {
    id: options.id,
    priority: 10,
    accepts: (payload) => acceptanceForTarget(kind, payload, options.path),
    onDrop: (payload, modifiers) =>
      dropOnTarget(kind, payload, options.path, options.remoteName, options.paneId, modifiers),
    onSpringLoad: options.onSpringLoad,
    springLoad: options.springLoad,
  };
}

export function dropKindForPath(path: string): TargetKind {
  if (path === "misty://trash") return "trash";
  if (path === "misty://library") return "library";
  if (path.startsWith("misty://")) return "invalid";
  return "directory";
}

function acceptanceForTarget(kind: TargetKind, payload: ExplorerDragPayload, destination: string) {
  if (kind === "invalid")
    return { valid: false, label: "Not a drop destination", action: "invalid" as const };
  if (kind === "trash") return { valid: true, label: "Move to Trash", action: "trash" as const };
  if (kind === "library") {
    if (payload.items.length > 500)
      return { valid: false, label: "Library accepts up to 500 files", action: "invalid" as const };
    if (payload.items.some((item) => item.isDirectory))
      return { valid: false, label: "Library accepts files only", action: "invalid" as const };
    return { valid: true, label: "Review for Library", action: "library" as const };
  }
  return transferDropAcceptance(payload, destination);
}

async function dropOnTarget(
  kind: TargetKind,
  payload: ExplorerDragPayload,
  destination: string,
  remoteName: string | null | undefined,
  paneId: string | undefined,
  modifiers: ExplorerDragModifiers,
) {
  const explorer = useExplorerStore.getState();
  const targetPaneId = paneId ?? useMultiPanelStore.getState().activePaneId;
  if (kind === "trash") {
    await explorerQueueDeleteItems({
      paths: payload.items.map((item) => item.path),
      permanent: false,
    });
    explorer.pushNotification(
      `Queued ${payload.items.length} item${payload.items.length === 1 ? "" : "s"} for Trash`,
      "success",
    );
    refreshAllPanes();
    return;
  }
  if (kind === "library") {
    const items = await resolveLibraryFiles(payload);
    await useSmartLibraryStore.getState().requestDroppedFiles(items);
    return;
  }
  if (kind !== "directory" || !targetPaneId) return;
  if (payload.origin === "external") {
    await explorer.dropExternalPaths(
      targetPaneId,
      payload.items.map((item) => item.path),
      destination,
    );
    return;
  }
  const groups = groupItemsByOperation(
    payload.items,
    storageIdForPath(destination, remoteName),
    modifiers.copyRequested,
  );
  if (groups.move.length) await explorer.dropItems(targetPaneId, groups.move, destination, "move");
  if (groups.copy.length) await explorer.dropItems(targetPaneId, groups.copy, destination, "copy");
}

async function resolveLibraryFiles(payload: ExplorerDragPayload): Promise<string[]> {
  const directoryFlags =
    payload.origin === "external"
      ? await Promise.all(payload.items.map((item) => explorerPathIsDirectory(item.path)))
      : payload.items.map((item) => item.isDirectory);
  if (directoryFlags.some(Boolean))
    throw new Error("Folders cannot be added to Library by dropping.");
  const remote = payload.items.filter((item) => item.location && item.location.kind !== "local");
  const local = payload.items
    .filter((item) => !item.location || item.location.kind === "local")
    .map((item) => item.path);
  if (!remote.length) return local;
  const prepared = await explorerPrepareDragItems({
    items: remote.map((item) => ({
      path: item.path,
      isDirectory: false,
      sizeBytes: item.sizeBytes,
      remoteModified: item.remoteModified,
    })),
  });
  if (prepared.skipped.length) {
    useExplorerStore
      .getState()
      .pushNotification(`Skipped ${prepared.skipped.length} remote Library item(s).`, "error");
  }
  return [...local, ...prepared.items.map((item) => item.localPath)];
}

function refreshAllPanes() {
  const explorer = useExplorerStore.getState();
  Object.keys(explorer.panes).forEach((paneId) => void explorer.refreshPane(paneId));
}

export type TargetKind = "directory" | "trash" | "library" | "invalid";
