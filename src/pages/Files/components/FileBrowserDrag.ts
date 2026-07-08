import type { DragEvent } from "react";
import type { FileEntry } from "../../../api/types";

const INTERNAL_DRAG_MIME = "application/x-misty-explorer-items";

export interface FileBrowserDragItem {
  path: string;
  isDirectory: boolean;
}

interface InternalDragItem extends FileBrowserDragItem {
  entryId: string;
}

export function dragItemsForEntry(
  entry: FileEntry,
  entries: FileEntry[],
  selectedIds: Set<string>,
): InternalDragItem[] {
  const sourceEntries = selectedIds.has(entry.id) && selectedIds.size > 1
    ? entries.filter((candidate) => selectedIds.has(candidate.id) && !candidate.isDeleted)
    : [entry];
  return sourceEntries.map((candidate) => ({
    entryId: candidate.id,
    path: candidate.path,
    isDirectory: candidate.kind === "folder",
  }));
}

export function beginInternalDrag(event: DragEvent<HTMLElement>, items: InternalDragItem[]): void {
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(INTERNAL_DRAG_MIME, JSON.stringify(items));
  event.dataTransfer.setData("text/plain", items.map((item) => item.path).join("\n"));
}

export function canDropOnEntry(event: DragEvent<HTMLElement>, entry: FileEntry): boolean {
  if (entry.isDeleted || entry.kind !== "folder" || !hasInternalDragItems(event)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "move";
  return true;
}

export function handleEntryDrop(
  event: DragEvent<HTMLElement>,
  entry: FileEntry,
  onDropItems: (items: FileBrowserDragItem[], destination: string) => void,
): void {
  if (entry.isDeleted || entry.kind !== "folder") return;
  const items = readInternalDragItems(event);
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  onDropItems(dropItemsExcludingDestination(items, entry.path), entry.path);
}

export function handlePaneDragOver(event: DragEvent<HTMLElement>): void {
  if (!hasInternalDragItems(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

export function handlePaneDrop(
  event: DragEvent<HTMLElement>,
  destination: string,
  onDropItems: (items: FileBrowserDragItem[], destination: string) => void,
): void {
  const items = readInternalDragItems(event);
  if (!items.length) return;
  event.preventDefault();
  onDropItems(dropItemsExcludingDestination(items, destination), destination);
}

function hasInternalDragItems(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes(INTERNAL_DRAG_MIME);
}

function readInternalDragItems(event: DragEvent<HTMLElement>): FileBrowserDragItem[] {
  const raw = event.dataTransfer.getData(INTERNAL_DRAG_MIME);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as FileBrowserDragItem[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item.path === "string" && item.path.length > 0)
      : [];
  } catch {
    return [];
  }
}

function dropItemsExcludingDestination(items: FileBrowserDragItem[], destination: string): FileBrowserDragItem[] {
  const normalizedDestination = normalizeDraggedPath(destination);
  return items.filter((item) => normalizeDraggedPath(item.path) !== normalizedDestination);
}

function normalizeDraggedPath(path: string): string {
  const normalized = (path || "/").replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized || "/";
}
