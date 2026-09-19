import type { FileEntry } from "@/native/contracts";
import { normalizeExplorerPath } from "@/shared/lib/pathNormalization";
import type {
  ExplorerBatchRenameItem,
  ExplorerInlineEditState,
  PaneExplorerState,
} from "../model/interfaces/store/types";

export function splitRenameParts(entry: FileEntry): [string, string] {
  if (entry.kind === "folder") return [entry.name, ""];
  const dot = entry.name.lastIndexOf(".");
  if (dot <= 0) return [entry.name, ""];
  return [entry.name.slice(0, dot), entry.name.slice(dot)];
}

export function validateRenameValue(
  value: string,
  lockedExtension: string,
  originalName: string,
  entryId: string | null,
  pane: PaneExplorerState | undefined,
  reservedNames: Set<string> | null = null,
): string | null {
  const trimmedValue = value.trim();
  const effectiveName = `${trimmedValue}${lockedExtension}`;
  if (!trimmedValue) {
    return "Name cannot be empty.";
  }
  if (value !== trimmedValue) {
    return "Name cannot begin or end with spaces.";
  }
  if (value.includes("/") || value.includes("\\")) {
    return "Name cannot contain path separators.";
  }
  if (value.includes("\0")) {
    return "Name contains an invalid character.";
  }
  if (
    effectiveName !== originalName &&
    pane?.listing?.entries.some(
      (entry) =>
        entry.id !== entryId && !reservedNames?.has(entry.id) && entry.name === effectiveName,
    )
  ) {
    return "Name already exists in this folder.";
  }
  return null;
}

export function validateBatchRenameItems(
  items: ExplorerBatchRenameItem[],
): ExplorerBatchRenameItem[] {
  const targetCounts = new Map<string, number>();
  for (const item of items) {
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    const targetPath = renameTargetPath(item.directoryPath, effectiveName);
    targetCounts.set(targetPath, (targetCounts.get(targetPath) ?? 0) + 1);
  }
  return items.map((item) => {
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    const baseError = validateRenameValue(
      item.value,
      item.lockedExtension,
      item.originalName,
      item.entryId,
      undefined,
    );
    const targetPath = renameTargetPath(item.directoryPath, effectiveName);
    const error =
      baseError ??
      ((targetCounts.get(targetPath) ?? 0) > 1
        ? "Another selected item will use this name."
        : null) ??
      (effectiveName !== item.originalName && item.siblingNames.includes(effectiveName)
        ? "Name already exists in this folder."
        : null);
    return { ...item, error };
  });
}

export function renameTargetPath(directoryPath: string, name: string): string {
  const directory = normalizeExplorerPath(directoryPath) || "/";
  return directory === "/" ? `/${name}` : `${directory}/${name}`;
}

export function withInlineEditValidation(
  edit: ExplorerInlineEditState,
  pane: PaneExplorerState | undefined,
): ExplorerInlineEditState {
  if (edit.kind === "rename" && edit.batchItems && edit.batchItems.length > 1) {
    const batchItems = validateBatchRenameItems(
      edit.batchItems.map((item) =>
        item.paneId === edit.paneId && item.entryId === edit.entryId
          ? { ...item, value: edit.value }
          : item,
      ),
    );
    const focused = batchItems.find(
      (item) => item.paneId === edit.paneId && item.entryId === edit.entryId,
    );
    const invalidCount = batchItems.filter((item) => item.error).length;
    const error =
      focused?.error ??
      (invalidCount > 0
        ? `${invalidCount} selected ${invalidCount === 1 ? "item needs" : "items need"} review.`
        : null);
    return { ...edit, batchItems, error };
  }
  const error = validateRenameValue(
    edit.value,
    edit.lockedExtension,
    edit.originalName,
    edit.entryId,
    pane,
  );
  return { ...edit, error };
}
