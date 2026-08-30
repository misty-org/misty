import type {
  FileTableColumn,
  FileTableColumnWidths,
} from "../../model/types/components/FileBrowser";
import {
  defaultColumnWidths,
  fileTableColumns,
  maximumColumnWidths,
  minimumColumnWidths,
} from "./fileTableConfig";

const TABLE_COLUMN_STORAGE_KEY = "misty.explorer.fileTable.columnWidths";
const TABLE_COLUMN_ORDER_STORAGE_KEY = "misty.explorer.fileTable.columnOrder";

/**
 * Column widths and order, persisted per browser.
 *
 * Stored values are user-editable and can be stale across releases, so every
 * read is validated and clamped rather than trusted.
 */
export function loadColumnWidths(): FileTableColumnWidths {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TABLE_COLUMN_STORAGE_KEY) ?? "{}",
    ) as Partial<FileTableColumnWidths>;
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

export function saveColumnWidths(widths: FileTableColumnWidths): void {
  window.localStorage.setItem(TABLE_COLUMN_STORAGE_KEY, JSON.stringify(widths));
}

export function clampColumnWidth(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/**
 * Restores the saved order, appending any column the stored list has never seen.
 *
 * Nothing writes this key today — reordering is read-only until the table grows
 * a drag-to-reorder affordance — but a stored order is still honoured.
 */
export function loadColumnOrder(): FileTableColumn[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TABLE_COLUMN_ORDER_STORAGE_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [...fileTableColumns];
    const unique = parsed
      .filter(isFileTableColumn)
      .filter((column, index, order) => order.indexOf(column) === index);
    const missing = fileTableColumns.filter((column) => !unique.includes(column));
    return unique.length > 0 ? [...unique, ...missing] : [...fileTableColumns];
  } catch {
    return [...fileTableColumns];
  }
}

/** Drops saved widths so the table falls back to defaults. */
export function clearColumnWidths(): void {
  window.localStorage.removeItem(TABLE_COLUMN_STORAGE_KEY);
}

function validColumnWidth(value: unknown, column: FileTableColumn): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clampColumnWidth(value, minimumColumnWidths[column], maximumColumnWidths[column])
    : defaultColumnWidths[column];
}

function isFileTableColumn(value: unknown): value is FileTableColumn {
  return value === "name" || value === "modified" || value === "size" || value === "type";
}
