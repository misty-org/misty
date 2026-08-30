import type { MountedDevice } from "@/native/contracts";
import type { ClipboardOperation } from "@/native/contracts/primitives";
import type { ExplorerDragItem } from "../model/interfaces/drag/types";
import { normalizedDragPath, pathContainsPath } from "./geometry";

export function storageIdForPath(
  path: string,
  remoteName: string | null | undefined,
  devices: Pick<MountedDevice, "id" | "mountPath">[] = [],
): string {
  if (remoteName) return `remote:${remoteName}`;
  const match = [...devices]
    .filter((device) => pathContainsPath(device.mountPath, path))
    .sort((left, right) => right.mountPath.length - left.mountPath.length)[0];
  if (match) return `device:${match.id}`;
  const normalized = normalizedDragPath(path);
  const macVolume = normalized.match(/^\/Volumes\/([^/]+)/);
  if (macVolume) return `volume:${macVolume[1]}`;
  const windowsVolume = normalized.match(/^([A-Za-z]:|\/\/[^/]+\/[^/]+)/);
  return windowsVolume ? `volume:${windowsVolume[1].toLowerCase()}` : "local:default";
}

export function operationForInternalDrop(
  item: ExplorerDragItem,
  destinationStorageId: string,
  copyRequested: boolean,
): ClipboardOperation {
  if (copyRequested) return "copy";
  return item.storageId && item.storageId === destinationStorageId ? "move" : "copy";
}

export function invalidTransferReason(
  items: ExplorerDragItem[],
  destination: string,
): string | null {
  const normalizedDestination = normalizedDragPath(destination);
  for (const item of items) {
    const source = normalizedDragPath(item.path);
    if (source === normalizedDestination) return "Item is already in this destination.";
    const parent = source.slice(0, source.lastIndexOf("/")) || "/";
    if (parent === normalizedDestination) return "Item is already in this folder.";
    if (item.isDirectory && pathContainsPath(source, normalizedDestination)) {
      return "A folder cannot be moved into itself.";
    }
  }
  return null;
}

export function groupItemsByOperation(
  items: ExplorerDragItem[],
  destinationStorageId: string,
  copyRequested: boolean,
): Record<ClipboardOperation, ExplorerDragItem[]> {
  const groups: Record<ClipboardOperation, ExplorerDragItem[]> = { copy: [], move: [] };
  for (const item of items) {
    groups[operationForInternalDrop(item, destinationStorageId, copyRequested)].push(item);
  }
  return groups;
}
