import {
  isTransferTableColumn,
  transferDefaultColumnWidths,
  transferMinimumColumnWidths,
  transferTableColumns,
} from "@/pages/Transfers/desktop/transferModel";
import type {
  MultiPanelClosedPane,
  MultiPanelTab,
  MultiPanelStore,
} from "@/models/interfaces/workspace";
import type {
  TransferColumnWidths,
  TransferTableColumn,
} from "@/models/types/pages/Transfers/desktop/transferModel";

const TRANSFERS_MULTIPANEL_STORAGE_KEY = "misty.transfers.multipanel.v1";
const TRANSFER_COLUMN_WIDTHS_STORAGE_KEY = "misty.transfers.table.columnWidths";
const TRANSFER_COLUMN_ORDER_STORAGE_KEY = "misty.transfers.table.columnOrder";
const TRANSFER_PANEL_VISIBILITY_STORAGE_KEY = "misty.transfers.panelVisibility";

export function saveTransfersMultiPanelSnapshot(state: MultiPanelStore): void {
  if (typeof window === "undefined" || state.tabs.length === 0) return;
  try {
    const snapshot: TransfersMultiPanelSnapshot = {
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      activePaneId: state.activePaneId,
      closedPanes: state.closedPanes,
      nextPaneIndex: state.nextPaneIndex,
      nextTabIndex: state.nextTabIndex,
    };
    window.localStorage.setItem(TRANSFERS_MULTIPANEL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Transfers remains usable when persistence is unavailable.
  }
}

export function loadTransfersMultiPanelSnapshot(): TransfersMultiPanelSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TRANSFERS_MULTIPANEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TransfersMultiPanelSnapshot>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    if (typeof parsed.activeTabId !== "string" || typeof parsed.activePaneId !== "string")
      return null;
    return {
      tabs: parsed.tabs,
      activeTabId: parsed.activeTabId,
      activePaneId: parsed.activePaneId,
      closedPanes: Array.isArray(parsed.closedPanes) ? parsed.closedPanes : [],
      nextPaneIndex: typeof parsed.nextPaneIndex === "number" ? parsed.nextPaneIndex : 1,
      nextTabIndex: typeof parsed.nextTabIndex === "number" ? parsed.nextTabIndex : 1,
    };
  } catch {
    return null;
  }
}

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

export interface TransfersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}
