export type FileListColumn = "name" | "modified" | "size" | "type";
export type FileListColumnWidths = Record<FileListColumn, number>;
export interface FileListSort {
  column: FileListColumn;
  direction: "asc" | "desc";
}

export const fileListColumns: FileListColumn[] = ["name", "modified", "size", "type"];

export const fileListColumnLabels: Record<FileListColumn, string> = {
  name: "Name",
  modified: "Modified",
  size: "Size",
  type: "Type",
};

export const defaultColumnWidths: FileListColumnWidths = {
  name: 220,
  modified: 220,
  size: 128,
  type: 128,
};

export const minimumColumnWidths: FileListColumnWidths = {
  name: 180,
  modified: 150,
  size: 92,
  type: 120,
};

export const maximumColumnWidths: FileListColumnWidths = {
  name: 640,
  modified: 360,
  size: 220,
  type: 260,
};

// The key is shared with the retired Files explorer, so widths people set there still apply.
const TABLE_COLUMN_STORAGE_KEY = "misty.explorer.fileTable.columnWidths";

/**
 * Column widths, persisted per browser.
 *
 * Stored values are user-editable and can be stale across releases, so every
 * read is validated and clamped rather than trusted.
 */
export function loadColumnWidths(): FileListColumnWidths {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TABLE_COLUMN_STORAGE_KEY) ?? "{}",
    ) as Partial<FileListColumnWidths>;
    return {
      name: validColumnWidth(parsed.name, "name"),
      modified: validColumnWidth(parsed.modified, "modified"),
      size: validColumnWidth(parsed.size, "size"),
      type: validColumnWidth(parsed.type, "type"),
    };
  } catch {
    return { ...defaultColumnWidths };
  }
}

export function saveColumnWidths(widths: FileListColumnWidths): void {
  window.localStorage.setItem(TABLE_COLUMN_STORAGE_KEY, JSON.stringify(widths));
}

/** Drops saved widths so the table falls back to defaults. */
export function clearColumnWidths(): void {
  window.localStorage.removeItem(TABLE_COLUMN_STORAGE_KEY);
}

export function clampColumnWidth(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function validColumnWidth(value: unknown, column: FileListColumn): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampColumnWidth(value, minimumColumnWidths[column], maximumColumnWidths[column])
    : defaultColumnWidths[column];
}
