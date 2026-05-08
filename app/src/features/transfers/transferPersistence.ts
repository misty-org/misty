import type {
  TransferColumnWidths,
  TransferTableColumn,
} from "./model/page-types/workspace/transferModel";
import {
  isTransferTableColumn,
  transferDefaultColumnWidths,
  transferMinimumColumnWidths,
  transferTableColumns,
} from "./transferModel";

const TRANSFER_COLUMN_WIDTHS_STORAGE_KEY = "misty.transfers.table.columnWidths";
const TRANSFER_COLUMN_ORDER_STORAGE_KEY = "misty.transfers.table.columnOrder";
const TRANSFER_PANEL_VISIBILITY_STORAGE_KEY = "misty.transfers.panelVisibility";

export function loadTransferColumnWidths(): TransferColumnWidths {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TRANSFER_COLUMN_WIDTHS_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object") return { ...transferDefaultColumnWidths };
    const widths = { ...transferDefaultColumnWidths };
    for (const column of transferTableColumns) {
      const value = Number((parsed as Partial<Record<TransferTableColumn, unknown>>)[column]);
      if (Number.isFinite(value))
        widths[column] = Math.max(transferMinimumColumnWidths[column], Math.min(640, value));
    }
    return widths;
  } catch {
    return { ...transferDefaultColumnWidths };
  }
}

export function saveTransferColumnWidths(widths: TransferColumnWidths): void {
  try {
    window.localStorage.setItem(TRANSFER_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Column resizing remains available for the current session.
  }
}

export function loadTransferColumnOrder(): TransferTableColumn[] {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TRANSFER_COLUMN_ORDER_STORAGE_KEY) ?? "[]",
    );
    const unique = Array.isArray(parsed)
      ? parsed.filter(
          (value, index): value is TransferTableColumn =>
            typeof value === "string" &&
            isTransferTableColumn(value) &&
            parsed.indexOf(value) === index,
        )
      : [];
    const missing = transferTableColumns.filter((column) => !unique.includes(column));
    return unique.length > 0 ? [...unique, ...missing] : [...transferTableColumns];
  } catch {
    return [...transferTableColumns];
  }
}

export function saveTransferColumnOrder(order: TransferTableColumn[]): void {
  try {
    window.localStorage.setItem(TRANSFER_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Column reordering remains available for the current session.
  }
}

export function loadTransferPanelVisibility(): { filters: boolean; detail: boolean } {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(TRANSFER_PANEL_VISIBILITY_STORAGE_KEY) ?? "{}",
    ) as Partial<{ filters: boolean; detail: boolean }>;
    return {
      filters: typeof parsed.filters === "boolean" ? parsed.filters : true,
      detail: typeof parsed.detail === "boolean" ? parsed.detail : true,
    };
  } catch {
    return { filters: true, detail: true };
  }
}

export function saveTransferPanelVisibility(visibility: {
  filters: boolean;
  detail: boolean;
}): void {
  try {
    window.localStorage.setItem(TRANSFER_PANEL_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Panel toggles remain available for the current session.
  }
}
