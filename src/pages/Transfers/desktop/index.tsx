import {
  ArrowDown,
  ArrowUp,
  Filter,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { OperationDescriptor, OperationPriority, TransferRecord, TransferType } from "../../../api/types";
import { prettyLabel } from "../../../shared/format";
import { useMinimumSpin } from "../../../shared/hooks/useMinimumSpin";
import { MultiPanelWorkspace } from "../../../shared/multipanel/MultiPanelWorkspace";
import type { MultiPanelClosedPane, MultiPanelTab } from "../../../shared/multipanel/types";
import { createMultiPanelStore, type MultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { useProvidersStore } from "../../../stores/useProvidersStore";
import { transferProfileRecords } from "../../Settings/transferProfiles";
import { useSettingsStore } from "../../../stores/useSettingsStore";
import { relativeTime, remoteSummary, transferProgress } from "../transferUtils";
import { useOperationQueueStore } from "../../../stores/useOperationQueueStore";
import {
  activeTransferFilterCount,
  createTransferWorkspaceState,
  TRANSFERS_PAGE_SIZE,
  transferStatusMatchesFilter,
  transferTypes,
  type TransferSortDirection,
  type TransferSortKey,
  useTransfersStore,
} from "../../../stores/useTransfersStore";

const useTransfersMultiPanelStore = createMultiPanelStore({ idPrefix: "transfers", defaultTitle: "Transfers" });

type TransferTableColumn = "transfer" | "operation" | "status" | "time" | "remote" | "actions";

type TransferColumnWidths = Record<TransferTableColumn, number>;
type TransferActionMenuState = {
  x: number;
  y: number;
  rowId: number | null;
} | null;
type TransferSortMenuState = {
  x: number;
  y: number;
} | null;
type TransferSortableKey = Exclude<TransferSortKey, "none">;

const transferTableColumns: TransferTableColumn[] = ["transfer", "operation", "status", "time", "remote", "actions"];
const transferColumnLabels: Record<TransferTableColumn, string> = {
  transfer: "Transfer",
  operation: "Operation",
  status: "Status",
  time: "Time",
  remote: "Remote",
  actions: "Actions",
};
const transferSortByColumn: Partial<Record<TransferTableColumn, TransferSortableKey>> = {
  transfer: "name",
  operation: "operation",
  status: "status",
  time: "time",
};
const transferSortOptions: Array<{ key: TransferSortableKey; label: string }> = [
  { key: "time", label: "Time" },
  { key: "name", label: "Name" },
  { key: "operation", label: "Operation" },
  { key: "status", label: "Status" },
];
const transferDefaultColumnWidths: TransferColumnWidths = {
  transfer: 280,
  operation: 135,
  status: 135,
  time: 130,
  remote: 180,
  actions: 160,
};
const transferMinimumColumnWidths: TransferColumnWidths = {
  transfer: 190,
  operation: 110,
  status: 110,
  time: 105,
  remote: 140,
  actions: 148,
};
const TRANSFER_CHECKBOX_COLUMN_WIDTH = 38;
const TRANSFERS_MULTIPANEL_STORAGE_KEY = "misty.transfers.multipanel.v1";
const TRANSFER_COLUMN_WIDTHS_STORAGE_KEY = "misty.transfers.table.columnWidths";
const TRANSFER_COLUMN_ORDER_STORAGE_KEY = "misty.transfers.table.columnOrder";
const TRANSFER_PANEL_VISIBILITY_STORAGE_KEY = "misty.transfers.panelVisibility";
const TRANSFER_ROW_HEIGHT = 46;
const TRANSFER_OVERSCAN_ROWS = 8;

const transferStyles = {
  workspace:
    "bg-[var(--misty-bg)]",
  pane:
    "grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_24px] overflow-hidden bg-[var(--misty-bg)]",
  toolbar:
    "relative flex min-w-0 items-center justify-end gap-2 border-b border-[var(--misty-border-soft)] bg-[var(--misty-bg)] px-2 py-2",
  toolbarButton:
    "inline-flex min-h-[38px] items-center gap-[7px] rounded-[10px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-[11px] py-2 text-[var(--misty-text)]",
  iconToolbarButton:
    "grid size-8 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)] disabled:opacity-45",
  toolbarDanger:
    "border-[color-mix(in_srgb,var(--misty-danger)_42%,var(--misty-border))] text-[var(--misty-danger)]",
  searchBox:
    "!flex !h-8 w-[min(340px,34vw)] min-w-52 !items-center !gap-2 rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] px-2.5 text-[var(--misty-text-muted)] !normal-case [&>input]:!h-full [&>input]:!min-w-0 [&>input]:!flex-1 [&>input]:!rounded-none [&>input]:!border-0 [&>input]:!bg-transparent [&>input]:!p-0 [&>input]:!text-sm [&>input]:!leading-none [&>input]:!text-[var(--misty-text)] [&>input]:!shadow-none [&>input]:!outline-none [&>input]:placeholder:!text-[var(--misty-text-subtle)]",
  sortMenu:
    "fixed z-[2147483000] grid w-44 gap-1 rounded-[10px] border border-[var(--misty-border)] bg-[var(--misty-surface)] p-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.38)]",
  sortMenuLabel:
    "px-2.5 py-1 text-[11px] font-bold uppercase text-[var(--misty-text-subtle)]",
  sortMenuItem:
    "flex h-8 min-w-0 items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-sm text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)]",
  sortMenuItemActive:
    "bg-[var(--misty-surface-3)]",
  sortMenuIcon:
    "grid size-4 shrink-0 place-items-center text-[var(--misty-text-muted)]",
  actionMenu:
    "fixed z-[2147483000] grid w-52 gap-1 rounded-[10px] border border-[var(--misty-border)] bg-[var(--misty-surface)] p-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.38)]",
  actionMenuItem:
    "flex h-8 min-w-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-sm text-[var(--misty-text)] hover:bg-[var(--misty-surface-3)] disabled:opacity-45",
  actionMenuDanger:
    "text-[var(--misty-danger)]",
  actionMenuSeparator: "my-1 h-px bg-[var(--misty-border-soft)]",
  activeFilterPill:
    "inline-flex min-h-[38px] items-center gap-[7px] whitespace-nowrap rounded-full border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-[11px] py-[7px] text-[var(--misty-text-muted)]",
  summary: "grid grid-cols-2 gap-2",
  summaryCard:
    "grid min-w-0 gap-1 border-b border-[var(--misty-border-soft)] pb-2",
  summaryLabel: "text-xs font-semibold uppercase text-[var(--misty-text-subtle)]",
  summaryValue: "text-2xl leading-none text-[var(--misty-text)]",
  summaryDetail:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs not-italic text-[var(--misty-text-muted)]",
  panelsScroll:
    "min-h-0 min-w-0 overflow-hidden",
  threePanel:
    "grid h-full min-h-0 w-full",
  panel:
    "min-h-0 min-w-0 overflow-hidden border-r border-[var(--misty-border-soft)] bg-[var(--misty-bg)] last:border-r-0",
  listPanel:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-[var(--misty-border-soft)] bg-[var(--misty-bg)]",
  listPanelNoRight:
    "border-r-0",
  pagination:
    "flex min-w-0 items-center justify-between gap-2 border-t border-[var(--misty-border-soft)] px-2 py-1.5 text-xs text-[var(--misty-text-muted)]",
  paginationButtons: "flex gap-1.5",
  paginationButton:
    "min-h-[26px] rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 py-1 text-[var(--misty-text)] disabled:opacity-40",
  contentScroll: "h-full overflow-auto p-3",
  filterHeading: "mb-3 flex items-center justify-between gap-2.5",
  filterTitle: "text-sm font-semibold text-[var(--misty-text)]",
  smallButton:
    "min-h-[30px] rounded-[9px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-[9px] py-[5px] text-[var(--misty-text)] disabled:opacity-45",
  filterSection: "grid gap-2.5 border-t border-[var(--misty-border-soft)] py-3 first:border-t-0 first:pt-0",
  filterSectionTitle: "m-0 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--misty-text-muted)]",
  filterOption:
    "grid min-h-7 min-w-0 cursor-default grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-0.5 text-sm leading-none text-[var(--misty-text)]",
  filterInput:
    "m-0 size-4 shrink-0 accent-[var(--misty-accent)]",
  filterOptionLabel:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-5",
  filterOptionCount: "justify-self-end not-italic text-xs text-[var(--misty-text-subtle)]",
  filterEmpty:
    "text-sm leading-5 text-[var(--misty-text-subtle)]",
  filterSelect:
    "w-full rounded-lg border border-[var(--misty-border)] bg-[var(--misty-surface)] px-2.5 py-2 text-[var(--misty-text)]",
  sortDirection: "grid grid-cols-2 gap-2",
  sortButtonSelected:
    "border-[var(--misty-accent)] bg-[color-mix(in_srgb,var(--misty-accent)_16%,var(--misty-surface))]",
  tableWrap:
    "h-full min-h-0 overflow-auto p-0 pr-3 [overscroll-behavior:contain] [scrollbar-gutter:stable_both-edges]",
  table: "border-collapse table-fixed",
  tableHeader:
    "sticky top-0 z-[2] select-none border-b border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 py-2 text-left align-middle text-[13px] font-semibold leading-none text-[var(--misty-text-muted)]",
  tableHeaderDragging: "opacity-60",
  tableHeaderControl:
    "inline-block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 align-middle font-[inherit] text-inherit",
  tableResizeHandle:
    "absolute right-[-3px] top-0 z-[3] h-full w-[7px] cursor-col-resize hover:bg-[rgba(79,141,255,0.34)]",
  tableRow:
    "group h-[46px] hover:bg-[color-mix(in_srgb,var(--misty-surface-3)_76%,transparent)]",
  tableRowFocused:
    "bg-[color-mix(in_srgb,var(--misty-accent)_14%,var(--misty-surface))]",
  tableCell:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap border-b border-[var(--misty-border-soft)] px-2.5 py-1.5 text-left align-middle text-[13px] leading-[16px]",
  tablePrimary: "block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold leading-[17px]",
  tableSecondary:
    "mt-px block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-[15px] text-[var(--misty-text-subtle)]",
  checkboxCell:
    "w-[38px] min-w-[38px] max-w-[38px] border-b border-[var(--misty-border-soft)] px-2 py-1.5 text-center align-middle",
  checkboxInput: "size-4",
  rowActions: "flex h-full items-center gap-2 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100",
  rowActionGroup:
    "inline-flex h-[30px] overflow-hidden rounded-[8px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)]",
  rowActionIconButton:
    "grid h-[28px] w-[30px] place-items-center border-0 border-r border-[var(--misty-border-soft)] bg-transparent p-0 text-[var(--misty-text)] last:border-r-0 hover:bg-[var(--misty-surface-3)] disabled:text-[var(--misty-text-subtle)] disabled:opacity-40",
  rowActionDangerButton:
    "grid h-[30px] w-[32px] place-items-center rounded-[8px] border border-[color-mix(in_srgb,var(--misty-danger)_42%,var(--misty-border))] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-danger)] hover:bg-[color-mix(in_srgb,var(--misty-danger)_12%,var(--misty-surface-2))] disabled:opacity-40",
  detailContent: "grid h-full content-start gap-2.5 overflow-auto p-3.5",
  detailEmpty: "h-full overflow-auto p-3.5",
  detailHeader: "grid gap-2 border-b border-[var(--misty-border-soft)] pb-3",
  detailTitle: "text-lg font-semibold text-[var(--misty-text)]",
  detailActions: "mt-3.5 grid gap-2 border-t border-[var(--misty-border-soft)] pt-3.5",
  detailRow: "grid gap-1 border-b border-[var(--misty-border-soft)] py-2",
  detailLabel: "text-[var(--misty-text-subtle)]",
  detailValue:
    "min-w-0 [overflow-wrap:anywhere] font-medium text-[var(--misty-text)]",
  detailDangerValue:
    "min-w-0 [overflow-wrap:anywhere] font-medium text-[var(--misty-danger)]",
  statusBadge:
    "inline-flex w-fit rounded-full bg-[var(--misty-surface-2)] px-2 py-[3px] text-xs leading-4 text-[var(--misty-text-muted)] capitalize",
  statusCompleted:
    "bg-[color-mix(in_srgb,var(--misty-success)_15%,var(--misty-surface))] text-[var(--misty-success)]",
  statusFailed:
    "bg-[color-mix(in_srgb,var(--misty-danger)_14%,var(--misty-surface))] text-[var(--misty-danger)]",
  statusActive:
    "bg-[color-mix(in_srgb,var(--misty-accent)_14%,var(--misty-surface))] text-[var(--misty-accent)]",
  operationStrip:
    "grid min-w-[920px] gap-[9px] rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-[11px]",
  operationSummary: "flex min-w-0 items-center gap-2.5",
  operationTitle: "font-semibold text-[var(--misty-text)]",
  operationMeta: "text-[var(--misty-text-subtle)]",
  operationActions: "flex min-w-0 flex-wrap items-center gap-2",
  operationButton:
    "inline-flex min-h-[30px] items-center gap-1.5 rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-[9px] py-[5px] text-[var(--misty-text)] disabled:opacity-50",
  operationInput:
    "h-[30px] w-28 rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-2 text-xs text-[var(--misty-text)] outline-none",
  operationSelect:
    "h-[30px] rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-2 text-xs text-[var(--misty-text)] outline-none",
  conflictRow:
    "grid min-w-0 grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto_auto] items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--misty-warning)_46%,var(--misty-border))] bg-[color-mix(in_srgb,var(--misty-warning)_10%,var(--misty-surface))] p-2 max-[980px]:grid-cols-[minmax(0,1fr)_auto_auto]",
  conflictMain: "grid min-w-0 gap-[3px] max-[980px]:col-span-full",
  conflictApply:
    "inline-flex min-h-[30px] items-center gap-[7px] whitespace-nowrap text-[var(--misty-text)] max-[980px]:col-span-full",
  conflictCheckbox: "size-3.5 accent-[var(--misty-warning)]",
  conflictText: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--misty-text-subtle)]",
  operationList: "grid gap-1.5",
  operationRow:
    "grid min-w-0 grid-cols-[minmax(160px,1fr)_120px_minmax(160px,1fr)_minmax(160px,1fr)_auto_auto_auto_auto] items-center gap-2 border-t border-[var(--misty-border-soft)] pt-[7px]",
  operationCell: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--misty-text-subtle)]",
  bottomBar:
    "flex min-w-0 items-center justify-between border-t border-[var(--misty-border-soft)] bg-[var(--misty-bg)] px-2",
  bottomBarSide: "flex min-w-0 items-center gap-1",
  bottomButton:
    "grid h-5 w-[22px] place-items-center rounded border-0 bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-surface-2)] hover:text-[var(--misty-text)]",
  bottomButtonSelected:
    "bg-[var(--misty-surface-2)] text-[var(--misty-text)]",
} as const;

interface TransfersMultiPanelSnapshot {
  tabs: MultiPanelTab[];
  activeTabId: string;
  activePaneId: string;
  closedPanes: MultiPanelClosedPane[];
  nextPaneIndex: number;
  nextTabIndex: number;
}

export const TransfersWorkspace = memo(function TransfersWorkspace() {
  useEffect(() => {
    const state = useTransfersMultiPanelStore.getState();
    if (state.tabs.length === 0) {
      const snapshot = loadTransfersMultiPanelSnapshot();
      if (!snapshot || !state.hydrate(snapshot)) {
        state.initialize("transfers://history", "Transfers");
      }
    }
    saveTransfersMultiPanelSnapshot(useTransfersMultiPanelStore.getState());
    return useTransfersMultiPanelStore.subscribe(saveTransfersMultiPanelSnapshot);
  }, []);

  return (
    <MultiPanelWorkspace
      className={transferStyles.workspace}
      store={useTransfersMultiPanelStore}
      renderPane={(paneId) => <TransferWorkspacePane workspaceId={paneId} />}
    />
  );
});

export const TransfersWorkspacePanel = memo(function TransfersWorkspacePanel(props: { workspaceId: string }) {
  return <TransferWorkspacePane workspaceId={props.workspaceId} />;
});

function snapshotTransfersMultiPanel(state: MultiPanelStore): TransfersMultiPanelSnapshot {
  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    activePaneId: state.activePaneId,
    closedPanes: state.closedPanes,
    nextPaneIndex: state.nextPaneIndex,
    nextTabIndex: state.nextTabIndex,
  };
}

function saveTransfersMultiPanelSnapshot(state: MultiPanelStore): void {
  if (typeof window === "undefined" || state.tabs.length === 0) return;
  try {
    window.localStorage.setItem(TRANSFERS_MULTIPANEL_STORAGE_KEY, JSON.stringify(snapshotTransfersMultiPanel(state)));
  } catch {
    // localStorage can be unavailable in private windows; Transfers still works without persistence.
  }
}

function loadTransfersMultiPanelSnapshot(): TransfersMultiPanelSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TRANSFERS_MULTIPANEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TransfersMultiPanelSnapshot>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    if (typeof parsed.activeTabId !== "string" || typeof parsed.activePaneId !== "string") return null;
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

const TransferWorkspacePane = memo(function TransferWorkspacePane(props: { workspaceId: string }) {
  const {
    transfers,
    workspaces,
    working,
    load,
    ensureWorkspace,
    setSearch,
    toggleTransfer,
    setTransfersSelected,
    toggleProviderFilter,
    toggleTypeFilter,
    setLocationScope,
    setStatusFilter,
    setSort,
    setPageIndex,
    clearFilters,
    setFocusedTransfer,
    deleteIds,
    deleteSelected,
    deleteAll,
  } = useTransfersStore(useShallow((state) => ({
    transfers: state.transfers,
    workspaces: state.workspaces,
    working: state.working,
    load: state.load,
    ensureWorkspace: state.ensureWorkspace,
    setSearch: state.setSearch,
    toggleTransfer: state.toggleTransfer,
    setTransfersSelected: state.setTransfersSelected,
    toggleProviderFilter: state.toggleProviderFilter,
    toggleTypeFilter: state.toggleTypeFilter,
    setLocationScope: state.setLocationScope,
    setStatusFilter: state.setStatusFilter,
    setSort: state.setSort,
    setPageIndex: state.setPageIndex,
    clearFilters: state.clearFilters,
    setFocusedTransfer: state.setFocusedTransfer,
    deleteIds: state.deleteIds,
    deleteSelected: state.deleteSelected,
    deleteAll: state.deleteAll,
  })));
  const workspace = workspaces[props.workspaceId] ?? createTransferWorkspaceState();
  const {
    search,
    selectedIds,
    providerFilters,
    typeFilters,
    locationScope,
    statusFilter,
    sortKey,
    sortDirection,
    pageIndex,
    focusedTransferId,
  } = workspace;
  const providerSnapshot = useProvidersStore((state) => state.providers);
  const loadProviders = useProvidersStore((state) => state.load);
  const loadQueue = useOperationQueueStore((state) => state.load);
  const queueSnapshot = useOperationQueueStore((state) => state.snapshot);
  const queueWorking = useOperationQueueStore((state) => state.working);
  const cancelOperation = useOperationQueueStore((state) => state.cancel);
  const retryOperation = useOperationQueueStore((state) => state.retry);
  const undoOperation = useOperationQueueStore((state) => state.undo);

  useEffect(() => {
    ensureWorkspace(props.workspaceId);
    void load();
    void loadQueue();
  }, [ensureWorkspace, load, loadQueue, props.workspaceId]);

  useEffect(() => {
    if (!providerSnapshot) void loadProviders(false);
  }, [loadProviders, providerSnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void load(undefined, { silent: true });
      void useOperationQueueStore.getState().load({ silent: true });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [load]);

  const rows = transfers?.rows ?? [];
  const providerLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const remote of providerSnapshot?.remotes ?? []) {
      labels.set(remote.name, `${prettyLabel(remote.type)} · ${remote.name}`);
    }
    return labels;
  }, [providerSnapshot?.remotes]);
  const providerGroups = useMemo(() => transferProviderGroups(rows, providerLabels), [providerLabels, rows]);
  const searchedRows = useMemo(() => filterTransferSearch(rows, search), [rows, search]);
  const filteredRows = useMemo(() => filterAndSortTransfers(searchedRows, {
    providerFilters,
    typeFilters,
    locationScope,
    statusFilter,
    sortKey,
    sortDirection,
  }), [locationScope, providerFilters, searchedRows, sortDirection, sortKey, statusFilter, typeFilters]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / TRANSFERS_PAGE_SIZE));
  const activePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageRows = filteredRows.slice(
    activePageIndex * TRANSFERS_PAGE_SIZE,
    (activePageIndex + 1) * TRANSFERS_PAGE_SIZE,
  );
  useEffect(() => {
    if (activePageIndex !== pageIndex) setPageIndex(props.workspaceId, activePageIndex);
  }, [activePageIndex, pageIndex, props.workspaceId, setPageIndex]);
  const focusedTransfer = filteredRows.find((row) => row.id === focusedTransferId) ?? filteredRows[0] ?? null;
  const activeFilterCount = activeTransferFilterCount({ providerFilters, typeFilters, locationScope, statusFilter });
  const queueOperationsByTransfer = useMemo(() => {
    const operations = new Map<number, NonNullable<typeof queueSnapshot>["operations"][number]>();
    for (const operation of queueSnapshot?.operations ?? []) {
      if (operation.transferId) operations.set(operation.transferId, operation);
    }
    return operations;
  }, [queueSnapshot?.operations]);
  const [actionMenu, setActionMenu] = useState<TransferActionMenuState>(null);
  const actionMenuTransfer = actionMenu?.rowId ? rows.find((row) => row.id === actionMenu.rowId) ?? null : null;
  const actionMenuOperation = actionMenuTransfer ? queueOperationsByTransfer.get(actionMenuTransfer.id) : undefined;
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const pageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollFrameRef = useRef<number | null>(null);
  const tableViewportHeightRef = useRef(0);
  const tableScrollTopRef = useRef(0);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [columnWidths, setColumnWidths] = useState<TransferColumnWidths>(loadTransferColumnWidths);
  const [columnOrder, setColumnOrder] = useState<TransferTableColumn[]>(loadTransferColumnOrder);
  const [draggedColumn, setDraggedColumn] = useState<TransferTableColumn | null>(null);
  const [panelVisibility, setPanelVisibility] = useState(loadTransferPanelVisibility);
  const [sortMenu, setSortMenu] = useState<TransferSortMenuState>(null);
  const filtersVisible = panelVisibility.filters;
  const detailVisible = panelVisibility.detail;
  const visibleColumnOrder = useMemo(() => columnOrder.filter((column) => column !== "remote"), [columnOrder]);
  const tableWidth = TRANSFER_CHECKBOX_COLUMN_WIDTH + visibleColumnOrder.reduce((sum, column) => sum + columnWidths[column], 0);
  const panelGridStyle = useMemo(() => ({
    gridTemplateColumns: [
      filtersVisible ? "240px" : "",
      "minmax(0, 1fr)",
      detailVisible ? "320px" : "",
    ].filter(Boolean).join(" "),
  }), [detailVisible, filtersVisible]);
  const rowCount = pageRows.length;
  const visibleCapacity = Math.max(1, Math.ceil(tableViewportHeight / TRANSFER_ROW_HEIGHT));
  const maxStartIndex = Math.max(0, rowCount - visibleCapacity - TRANSFER_OVERSCAN_ROWS);
  const startIndex = Math.min(
    maxStartIndex,
    Math.max(0, Math.floor(tableScrollTop / TRANSFER_ROW_HEIGHT) - TRANSFER_OVERSCAN_ROWS),
  );
  const endIndex = Math.min(rowCount, startIndex + visibleCapacity + TRANSFER_OVERSCAN_ROWS * 2);
  const visibleRows = pageRows.slice(startIndex, endIndex);
  const topSpacerHeight = startIndex * TRANSFER_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (rowCount - endIndex) * TRANSFER_ROW_HEIGHT);
  const updateTableViewport = useCallback(() => {
    const element = tableScrollRef.current;
    if (!element) return;
    if (tableViewportHeightRef.current !== element.clientHeight) {
      tableViewportHeightRef.current = element.clientHeight;
      setTableViewportHeight(element.clientHeight);
    }
    if (tableScrollTopRef.current !== element.scrollTop) {
      tableScrollTopRef.current = element.scrollTop;
      setTableScrollTop(element.scrollTop);
    }
  }, []);
  useEffect(() => {
    updateTableViewport();
    const element = tableScrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateTableViewport);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (tableScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(tableScrollFrameRef.current);
        tableScrollFrameRef.current = null;
      }
    };
  }, [rowCount, updateTableViewport]);
  const handleTableScroll = useCallback(() => {
    if (tableScrollFrameRef.current !== null) return;
    tableScrollFrameRef.current = window.requestAnimationFrame(() => {
      tableScrollFrameRef.current = null;
      const element = tableScrollRef.current;
      if (!element) return;
      if (tableScrollTopRef.current !== element.scrollTop) {
        tableScrollTopRef.current = element.scrollTop;
        setTableScrollTop(element.scrollTop);
      }
    });
  }, []);
  const handleUndo = useCallback((undoTokenId: number) => {
    void undoOperation(undoTokenId).then(() => {
      void load(undefined, { silent: true });
      void useOperationQueueStore.getState().load({ silent: true });
    });
  }, [load, undoOperation]);
  const refreshAfterQueueMutation = useCallback(async (action: Promise<void>) => {
    await action;
    void load(undefined, { silent: true });
    void useOperationQueueStore.getState().load({ silent: true });
  }, [load]);
  const handleCancelOperation = useCallback(
    (operationId: number) => refreshAfterQueueMutation(cancelOperation(operationId)),
    [cancelOperation, refreshAfterQueueMutation],
  );
  const handleRetryOperation = useCallback(
    (operationId: number) => refreshAfterQueueMutation(retryOperation(operationId)),
    [refreshAfterQueueMutation, retryOperation],
  );
  const handleDeleteTransfer = useCallback(
    (transferId: number) => {
      void deleteIds(props.workspaceId, [transferId]);
    },
    [deleteIds, props.workspaceId],
  );
  const handleDeleteSelected = useCallback(() => {
    void deleteSelected(props.workspaceId);
  }, [deleteSelected, props.workspaceId]);
  const handleDeleteAll = useCallback(() => {
    void deleteAll();
  }, [deleteAll]);
  const openToolbarActionMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setActionMenu({
      x: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216)),
      y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 180)),
      rowId: null,
    });
  }, []);
  const openSortMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setSortMenu({
      x: Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184)),
      y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 180)),
    });
  }, []);
  const openRowActionMenu = useCallback((event: ReactMouseEvent, row: TransferRecord) => {
    event.preventDefault();
    event.stopPropagation();
    setFocusedTransfer(props.workspaceId, row.id);
    setActionMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 180)),
      rowId: row.id,
    });
  }, [props.workspaceId, setFocusedTransfer]);
  const closeActionMenu = useCallback(() => setActionMenu(null), []);
  const closeSortMenu = useCallback(() => setSortMenu(null), []);
  useEffect(() => {
    if (!actionMenu) return;
    const close = () => setActionMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionMenu]);
  useEffect(() => {
    if (!sortMenu) return;
    const close = () => setSortMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [sortMenu]);
  const beginColumnResize = useCallback((column: TransferTableColumn, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column];
    let pendingWidth = startWidth;
    let frame: number | null = null;
    const applyWidth = () => {
      frame = null;
      setColumnWidths((current) => current[column] === pendingWidth ? current : { ...current, [column]: pendingWidth });
    };
    const onPointerMove = (moveEvent: PointerEvent) => {
      pendingWidth = Math.max(transferMinimumColumnWidths[column], startWidth + moveEvent.clientX - startX);
      if (frame === null) frame = window.requestAnimationFrame(applyWidth);
    };
    const onPointerUp = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      const next = { ...columnWidths, [column]: pendingWidth };
      setColumnWidths(next);
      saveTransferColumnWidths(next);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }, [columnWidths]);
  const reorderColumn = useCallback((source: TransferTableColumn, target: TransferTableColumn) => {
    if (source === target) return;
    setColumnOrder((current) => {
      const withoutSource = current.filter((column) => column !== source);
      const targetIndex = withoutSource.indexOf(target);
      if (targetIndex < 0) return current;
      const next = [...withoutSource.slice(0, targetIndex), source, ...withoutSource.slice(targetIndex)];
      saveTransferColumnOrder(next);
      return next;
    });
  }, []);
  const setFiltersVisible = useCallback((visible: boolean) => {
    setPanelVisibility((current) => {
      const next = { ...current, filters: visible };
      saveTransferPanelVisibility(next);
      return next;
    });
  }, []);
  const setDetailVisible = useCallback((visible: boolean) => {
    setPanelVisibility((current) => {
      const next = { ...current, detail: visible };
      saveTransferPanelVisibility(next);
      return next;
    });
  }, []);

  return (
    <div className={transferStyles.pane}>
      <TransferSortMenu
        menu={sortMenu}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onClose={closeSortMenu}
        onSort={(key) => setSort(props.workspaceId, key)}
      />
      <TransferActionMenu
        menu={actionMenu}
        row={actionMenuTransfer}
        operation={actionMenuOperation}
        selectedCount={selectedCount}
        hasTransfers={Boolean(transfers && transfers.totalCount > 0)}
        historyWorking={working}
        queueWorking={queueWorking}
        onClose={closeActionMenu}
        onCancel={handleCancelOperation}
        onRetry={handleRetryOperation}
        onDeleteRow={handleDeleteTransfer}
        onDeleteSelected={handleDeleteSelected}
        onDeleteAll={handleDeleteAll}
      />
      <OperationQueueStrip
        onQueueChanged={() => {
          void load(undefined, { silent: true });
        }}
      />

      <div className={transferStyles.panelsScroll}>
        <div className={transferStyles.threePanel} style={panelGridStyle}>
          {filtersVisible ? (
            <aside className={transferStyles.panel}>
              <TransferFilters
                providerGroups={providerGroups}
                providerFilters={providerFilters}
                typeFilters={typeFilters}
                locationScope={locationScope}
                statusFilter={statusFilter}
                sortKey={sortKey}
                sortDirection={sortDirection}
                activeFilterCount={activeFilterCount}
                onToggleProvider={(provider) => toggleProviderFilter(props.workspaceId, provider)}
                onToggleType={(type) => toggleTypeFilter(props.workspaceId, type)}
                onLocationScope={(scope) => setLocationScope(props.workspaceId, scope)}
                onStatusFilter={(filter) => setStatusFilter(props.workspaceId, filter)}
                onSort={(key, direction) => setSort(props.workspaceId, key, direction)}
                onClear={() => clearFilters(props.workspaceId)}
              />
            </aside>
          ) : null}

          <main className={`${transferStyles.listPanel} ${detailVisible ? "" : transferStyles.listPanelNoRight}`}>
            <div className={transferStyles.toolbar}>
              <label className={transferStyles.searchBox}>
                <Search size={16} />
                <input
                  value={search}
                  placeholder="Search transfers"
                  onChange={(event) => setSearch(props.workspaceId, event.target.value)}
                />
              </label>
              <button
                className={transferStyles.iconToolbarButton}
                type="button"
                aria-label="Sort transfers"
                aria-haspopup="menu"
                aria-expanded={Boolean(sortMenu)}
                title="Sort transfers"
                onClick={openSortMenu}
              >
                <Filter size={16} />
              </button>
              <button
                className={transferStyles.iconToolbarButton}
                type="button"
                aria-label="More transfer actions"
                aria-haspopup="menu"
                aria-expanded={Boolean(actionMenu && actionMenu.rowId === null)}
                onClick={openToolbarActionMenu}
              >
                <MoreVertical size={16} />
              </button>
            </div>
            <div ref={tableScrollRef} className={transferStyles.tableWrap} onScroll={handleTableScroll}>
              <table className={transferStyles.table} style={{ width: tableWidth, minWidth: "calc(100% - 12px)" }}>
                <colgroup>
                  <col style={{ width: TRANSFER_CHECKBOX_COLUMN_WIDTH }} />
                  {visibleColumnOrder.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th className={transferStyles.checkboxCell}>
                      <input
                        className={transferStyles.checkboxInput}
                        type="checkbox"
                        aria-label={pageSelected ? "Deselect visible transfers" : "Select visible transfers"}
                        checked={pageSelected}
                        disabled={pageIds.length === 0}
                        onChange={(event) => setTransfersSelected(props.workspaceId, pageIds, event.target.checked)}
                      />
                    </th>
                    {visibleColumnOrder.map((column) => (
                      <TransferTableHeader
                        key={column}
                        column={column}
                        label={transferColumnLabels[column]}
                        sortKey={sortKey}
                        sortDirection={sortDirection}
                        dragging={draggedColumn === column}
                        onSort={(key) => setSort(props.workspaceId, key)}
                        onResizeStart={beginColumnResize}
                        onDragStart={setDraggedColumn}
                        onDragEnd={() => setDraggedColumn(null)}
                        onColumnDrop={reorderColumn}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topSpacerHeight > 0 ? (
                    <tr aria-hidden="true">
                      <td colSpan={visibleColumnOrder.length + 1} style={{ height: topSpacerHeight, padding: 0 }} />
                    </tr>
                  ) : null}
                  {visibleRows.map((row) => {
                    const operation = queueOperationsByTransfer.get(row.id);
                    return (
                      <TransferTableRow
                        key={row.id}
                        row={row}
                        columnOrder={visibleColumnOrder}
                        operation={operation}
                        selected={selectedIds.has(row.id)}
                        focused={focusedTransfer?.id === row.id}
                        queueWorking={queueWorking}
                        historyWorking={working}
                        onSelect={(id, checked) => toggleTransfer(props.workspaceId, id, checked)}
                        onFocus={(id) => setFocusedTransfer(props.workspaceId, id)}
                        onCancel={handleCancelOperation}
                        onRetry={handleRetryOperation}
                        onUndo={handleUndo}
                        onDelete={handleDeleteTransfer}
                        onContextMenu={openRowActionMenu}
                      />
                    );
                  })}
                  {bottomSpacerHeight > 0 ? (
                    <tr aria-hidden="true">
                      <td colSpan={visibleColumnOrder.length + 1} style={{ height: bottomSpacerHeight, padding: 0 }} />
                    </tr>
                  ) : null}
                </tbody>
              </table>
              {transfers && filteredRows.length === 0 ? <div className="m-[18px] text-[var(--misty-text-muted)]">No transfer history matches these filters.</div> : null}
            </div>
            <div className={transferStyles.pagination}>
              <span>
                {filteredRows.length === 0
                  ? "No transfers"
                  : `Page ${activePageIndex + 1} of ${pageCount} · ${filteredRows.length} transfers`}
              </span>
              <div className={transferStyles.paginationButtons}>
                <button
                  className={transferStyles.paginationButton}
                  type="button"
                  disabled={activePageIndex === 0 || filteredRows.length === 0}
                  onClick={() => setPageIndex(props.workspaceId, activePageIndex - 1)}
                >
                  Previous
                </button>
                <button
                  className={transferStyles.paginationButton}
                  type="button"
                  disabled={activePageIndex + 1 >= pageCount || filteredRows.length === 0}
                  onClick={() => setPageIndex(props.workspaceId, activePageIndex + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </main>

          {detailVisible ? (
            <aside className={transferStyles.panel}>
              <TransferDetail
                transfer={focusedTransfer}
                operation={focusedTransfer ? queueOperationsByTransfer.get(focusedTransfer.id) : undefined}
                working={queueWorking}
                historyWorking={working}
                onCancel={handleCancelOperation}
                onRetry={handleRetryOperation}
                onUndo={handleUndo}
                onDelete={handleDeleteTransfer}
              />
            </aside>
          ) : null}
        </div>
      </div>
      <TransfersBottomBar
        filtersVisible={filtersVisible}
        detailVisible={detailVisible}
        onToggleFilters={() => setFiltersVisible(!filtersVisible)}
        onToggleDetail={() => setDetailVisible(!detailVisible)}
      />
    </div>
  );
});

function TransfersBottomBar(props: {
  filtersVisible: boolean;
  detailVisible: boolean;
  onToggleFilters: () => void;
  onToggleDetail: () => void;
}) {
  const LeftIcon = props.filtersVisible ? PanelLeftClose : PanelLeftOpen;
  const RightIcon = props.detailVisible ? PanelRightClose : PanelRightOpen;
  return (
    <footer className={transferStyles.bottomBar}>
      <div className={transferStyles.bottomBarSide}>
        <button
          type="button"
          className={`${transferStyles.bottomButton} ${props.filtersVisible ? transferStyles.bottomButtonSelected : ""}`}
          title={props.filtersVisible ? "Hide filters" : "Show filters"}
          aria-label={props.filtersVisible ? "Hide filters" : "Show filters"}
          onClick={props.onToggleFilters}
        >
          <LeftIcon size={15} />
        </button>
      </div>
      <div className={transferStyles.bottomBarSide}>
        <button
          type="button"
          className={`${transferStyles.bottomButton} ${props.detailVisible ? transferStyles.bottomButtonSelected : ""}`}
          title={props.detailVisible ? "Hide details" : "Show details"}
          aria-label={props.detailVisible ? "Hide details" : "Show details"}
          onClick={props.onToggleDetail}
        >
          <RightIcon size={15} />
        </button>
      </div>
    </footer>
  );
}

export default TransfersWorkspace;

function TransferSortMenu(props: {
  menu: TransferSortMenuState;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  onClose: () => void;
  onSort: (key: TransferSortableKey) => void;
}) {
  if (!props.menu) return null;
  const run = (key: TransferSortableKey) => {
    props.onClose();
    props.onSort(key);
  };
  return createPortal(
    <div
      className={transferStyles.sortMenu}
      style={{ left: props.menu.x, top: props.menu.y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className={transferStyles.sortMenuLabel}>Sort By</span>
      {transferSortOptions.map((option) => {
        const active = props.sortKey === option.key;
        const DirectionIcon = props.sortDirection === "asc" ? ArrowUp : ArrowDown;
        const currentLabel = active
          ? props.sortDirection === "asc" ? "sorted ascending" : "sorted descending"
          : "not sorted";
        const nextLabel = !active
          ? "sort ascending"
          : props.sortDirection === "asc" ? "sort descending" : "clear sorting";
        return (
          <button
            key={option.key}
            className={`${transferStyles.sortMenuItem} ${active ? transferStyles.sortMenuItemActive : ""}`}
            type="button"
            role="menuitemcheckbox"
            aria-checked={active}
            aria-label={`${option.label}, ${currentLabel}. Activate to ${nextLabel}.`}
            onClick={() => run(option.key)}
          >
            <span>{option.label}</span>
            <span className={transferStyles.sortMenuIcon} aria-hidden="true">
              {active ? <DirectionIcon size={15} strokeWidth={2.4} /> : null}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

function TransferActionMenu(props: {
  menu: TransferActionMenuState;
  row: TransferRecord | null;
  operation?: OperationDescriptor;
  selectedCount: number;
  hasTransfers: boolean;
  historyWorking: boolean;
  queueWorking: boolean;
  onClose: () => void;
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  onDeleteRow: (transferId: number) => void;
  onDeleteSelected: () => void;
  onDeleteAll: () => void;
}) {
  if (!props.menu) return null;
  const run = (action: () => void) => {
    props.onClose();
    action();
  };
  const canCancel = Boolean(props.operation?.cancelable && !props.queueWorking);
  const canRetry = Boolean(props.operation?.retryable && props.operation.status === "failed" && !props.queueWorking);
  return createPortal(
    <div
      className={transferStyles.actionMenu}
      style={{ left: props.menu.x, top: props.menu.y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.row ? (
        <>
          <button
            className={transferStyles.actionMenuItem}
            type="button"
            role="menuitem"
            disabled={!canCancel}
            onClick={() => props.operation && run(() => void props.onCancel(props.operation!.operationId))}
          >
            <XCircle size={14} />
            Cancel
          </button>
          <button
            className={transferStyles.actionMenuItem}
            type="button"
            role="menuitem"
            disabled={!canRetry}
            onClick={() => props.operation && run(() => void props.onRetry(props.operation!.operationId))}
          >
            <RotateCcw size={14} />
            Retry
          </button>
          <div className={transferStyles.actionMenuSeparator} />
          <button
            className={`${transferStyles.actionMenuItem} ${transferStyles.actionMenuDanger}`}
            type="button"
            role="menuitem"
            disabled={props.historyWorking}
            onClick={() => run(() => props.onDeleteRow(props.row!.id))}
          >
            <Trash2 size={14} />
            Delete history row
          </button>
        </>
      ) : null}
      <button
        className={`${transferStyles.actionMenuItem} ${transferStyles.actionMenuDanger}`}
        type="button"
        role="menuitem"
        disabled={props.selectedCount === 0 || props.historyWorking}
        onClick={() => run(props.onDeleteSelected)}
      >
        <Trash2 size={14} />
        {props.selectedCount > 0 ? `Delete selected (${props.selectedCount})` : "Delete selected"}
      </button>
      <button
        className={`${transferStyles.actionMenuItem} ${transferStyles.actionMenuDanger}`}
        type="button"
        role="menuitem"
        disabled={!props.hasTransfers || props.historyWorking}
        onClick={() => run(props.onDeleteAll)}
      >
        <Trash2 size={14} />
        Clear all history
      </button>
    </div>,
    document.body,
  );
}

function summarizeTransfers(rows: TransferRecord[]) {
  let active = 0;
  let completed = 0;
  let failed = 0;
  let waiting = 0;
  for (const row of rows) {
    if (row.status === "completed") completed += 1;
    else if (row.status === "failed" || row.status === "canceled" || row.status === "interrupted") failed += 1;
    else if (row.status === "waiting_for_resolution") waiting += 1;
    else active += 1;
  }
  return { active, completed, failed, waiting, total: rows.length };
}

const TransferSummaryCards = memo(function TransferSummaryCards(props: {
  summary: ReturnType<typeof summarizeTransfers>;
  visibleCount: number;
}) {
  const cards = [
    { label: "Visible", value: props.visibleCount, detail: `${props.summary.total} total loaded` },
    { label: "Active", value: props.summary.active, detail: "queued or running" },
    { label: "Completed", value: props.summary.completed, detail: "finished cleanly" },
    { label: "Attention", value: props.summary.failed + props.summary.waiting, detail: "failed or waiting" },
  ];

  return (
    <div className={transferStyles.summary} aria-label="Transfer summary">
      {cards.map((card) => (
        <div className={transferStyles.summaryCard} key={card.label}>
          <span className={transferStyles.summaryLabel}>{card.label}</span>
          <strong className={transferStyles.summaryValue}>{card.value}</strong>
          <em className={transferStyles.summaryDetail}>{card.detail}</em>
        </div>
      ))}
    </div>
  );
});

const TransferTableHeader = memo(function TransferTableHeader(props: {
  column: TransferTableColumn;
  label: string;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  dragging: boolean;
  onSort: (key: TransferSortableKey) => void;
  onResizeStart: (column: TransferTableColumn, event: ReactPointerEvent) => void;
  onDragStart: (column: TransferTableColumn) => void;
  onDragEnd: () => void;
  onColumnDrop: (source: TransferTableColumn, target: TransferTableColumn) => void;
}) {
  const sort = transferSortByColumn[props.column];
  return (
    <th
      className={`${transferStyles.tableHeader} ${props.dragging ? transferStyles.tableHeaderDragging : ""}`}
      draggable
      aria-sort={sort && props.sortKey === sort ? (props.sortDirection === "asc" ? "ascending" : "descending") : "none"}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-misty-transfer-column", props.column);
        props.onDragStart(props.column);
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-misty-transfer-column")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        const source = event.dataTransfer.getData("application/x-misty-transfer-column") as TransferTableColumn;
        if (isTransferTableColumn(source)) {
          event.preventDefault();
          props.onColumnDrop(source, props.column);
        }
        props.onDragEnd();
      }}
    >
      {sort ? (
        <button className={transferStyles.tableHeaderControl} type="button" onClick={() => props.onSort(sort)}>
          {props.label} {sortIndicator(props.sortKey, props.sortDirection, sort)}
        </button>
      ) : (
        <span className={transferStyles.tableHeaderControl}>{props.label}</span>
      )}
      <span
        className={transferStyles.tableResizeHandle}
        aria-hidden="true"
        onPointerDown={(event) => props.onResizeStart(props.column, event)}
      />
    </th>
  );
});

const TransferTableRow = memo(function TransferTableRow(props: {
  row: TransferRecord;
  columnOrder: TransferTableColumn[];
  operation?: OperationDescriptor;
  selected: boolean;
  focused: boolean;
  queueWorking: boolean;
  historyWorking: boolean;
  onSelect: (id: number, checked: boolean) => void;
  onFocus: (id: number | null) => void;
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDelete: (transferId: number) => void;
  onContextMenu: (event: ReactMouseEvent, row: TransferRecord) => void;
}) {
  return (
    <tr
      className={`${transferStyles.tableRow} ${props.focused ? transferStyles.tableRowFocused : ""}`}
      onClick={() => props.onFocus(props.row.id)}
      onContextMenu={(event) => props.onContextMenu(event, props.row)}
    >
      <td className={transferStyles.checkboxCell} onClick={(event) => event.stopPropagation()}>
        <input
          className={transferStyles.checkboxInput}
          type="checkbox"
          checked={props.selected}
          onChange={(event) => props.onSelect(props.row.id, event.target.checked)}
        />
      </td>
      {props.columnOrder.map((column) => (
        <TransferTableCell
          key={column}
          column={column}
          row={props.row}
          operation={props.operation}
          queueWorking={props.queueWorking}
          historyWorking={props.historyWorking}
          onCancel={props.onCancel}
          onRetry={props.onRetry}
          onUndo={props.onUndo}
          onDelete={props.onDelete}
        />
      ))}
    </tr>
  );
});

const TransferTableCell = memo(function TransferTableCell(props: {
  column: TransferTableColumn;
  row: TransferRecord;
  operation?: OperationDescriptor;
  queueWorking: boolean;
  historyWorking: boolean;
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDelete: (transferId: number) => void;
}) {
  switch (props.column) {
    case "transfer":
      return (
        <td className={transferStyles.tableCell}>
          <strong className={transferStyles.tablePrimary}>{primaryTransferLabel(props.row)}</strong>
          <span className={transferStyles.tableSecondary}>J-{props.row.jobId} · {secondaryTransferLabel(props.row)}</span>
        </td>
      );
    case "operation":
      return <td className={transferStyles.tableCell}>{prettyLabel(props.row.transferType)}</td>;
    case "status":
      return (
        <td className={transferStyles.tableCell}>
          <span className={statusBadgeClass(props.row.status)}>{tableStatusLabel(props.row.status)}</span>
        </td>
      );
    case "time":
      return <td className={transferStyles.tableCell}>{relativeTime(transferTime(props.row))}</td>;
    case "remote":
      return <td className={transferStyles.tableCell}>{remoteSummary(props.row)}</td>;
    case "actions":
      return (
        <td className={transferStyles.tableCell} onClick={(event) => event.stopPropagation()}>
          <div className={transferStyles.rowActions}>
            <div className={transferStyles.rowActionGroup} role="group" aria-label="Transfer operation actions">
              <button
                className={transferStyles.rowActionIconButton}
                type="button"
                aria-label="Cancel transfer"
                title="Cancel transfer"
                disabled={!props.operation?.cancelable || props.queueWorking}
                onClick={() => props.operation && void props.onCancel(props.operation.operationId)}
              >
                <XCircle aria-hidden="true" size={14} />
              </button>
              <button
                className={transferStyles.rowActionIconButton}
                type="button"
                aria-label="Retry transfer"
                title="Retry transfer"
                disabled={!props.operation?.retryable || props.operation.status !== "failed" || props.queueWorking}
                onClick={() => props.operation && void props.onRetry(props.operation.operationId)}
              >
                <RotateCcw aria-hidden="true" size={14} />
              </button>
              <button
                className={transferStyles.rowActionIconButton}
                type="button"
                aria-label="Undo transfer"
                title="Undo transfer"
                disabled={!props.row.undoable || !props.row.undoTokenId || props.queueWorking}
                onClick={() => props.onUndo(props.row.undoTokenId)}
              >
                <RefreshCcw aria-hidden="true" size={14} />
              </button>
            </div>
            <button
              className={transferStyles.rowActionDangerButton}
              type="button"
              aria-label="Delete transfer history row"
              title="Delete transfer history row"
              disabled={props.historyWorking}
              onClick={() => props.onDelete(props.row.id)}
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </div>
        </td>
      );
  }
});

function TransferFilters(props: {
  providerGroups: Array<{ key: string; label: string; count: number }>;
  providerFilters: Set<string>;
  typeFilters: Set<TransferType>;
  locationScope: string;
  statusFilter: string;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  activeFilterCount: number;
  onToggleProvider: (provider: string) => void;
  onToggleType: (type: TransferType) => void;
  onLocationScope: (scope: "all" | "local" | "remote") => void;
  onStatusFilter: (filter: "all" | "active" | "completed" | "failed") => void;
  onSort: (key: TransferSortKey, direction?: TransferSortDirection) => void;
  onClear: () => void;
}) {
  return (
    <div className={transferStyles.contentScroll}>
      <div className={transferStyles.filterHeading}>
        <strong className={transferStyles.filterTitle}>Filters</strong>
        <button className={transferStyles.smallButton} type="button" disabled={props.activeFilterCount === 0} onClick={props.onClear}>Clear</button>
      </div>
      <FilterSection title="Providers">
        {props.providerGroups.length === 0 ? <span className={transferStyles.filterEmpty}>No remote providers</span> : null}
        {props.providerGroups.map((group) => (
          <label key={group.key} className={transferStyles.filterOption}>
            <input
              className={transferStyles.filterInput}
              type="checkbox"
              checked={props.providerFilters.has(group.key)}
              onChange={() => props.onToggleProvider(group.key)}
            />
            <span className={transferStyles.filterOptionLabel}>{group.label}</span>
            <em className={transferStyles.filterOptionCount}>{group.count}</em>
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Transfer Type">
        {transferTypes.map((type) => (
          <label key={type} className={transferStyles.filterOption}>
            <input
              className={transferStyles.filterInput}
              type="checkbox"
              checked={props.typeFilters.has(type)}
              onChange={() => props.onToggleType(type)}
            />
            <span className={transferStyles.filterOptionLabel}>{prettyLabel(type)}</span>
            <span aria-hidden="true" />
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Location">
        {(["all", "local", "remote"] as const).map((scope) => (
          <label key={scope} className={transferStyles.filterOption}>
            <input
              className={transferStyles.filterInput}
              type="radio"
              checked={props.locationScope === scope}
              onChange={() => props.onLocationScope(scope)}
            />
            <span className={transferStyles.filterOptionLabel}>
              {scope === "all" ? "All" : scope === "local" ? "Local only" : "Remote involved"}
            </span>
            <span aria-hidden="true" />
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Status">
        {(["all", "active", "completed", "failed"] as const).map((filter) => (
          <label key={filter} className={transferStyles.filterOption}>
            <input
              className={transferStyles.filterInput}
              type="radio"
              checked={props.statusFilter === filter}
              onChange={() => props.onStatusFilter(filter)}
            />
            <span className={transferStyles.filterOptionLabel}>{prettyLabel(filter)}</span>
            <span aria-hidden="true" />
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Sort">
        <select
          className={transferStyles.filterSelect}
          value={props.sortKey}
          onChange={(event) => {
            const key = event.target.value as TransferSortKey;
            props.onSort(key, key === "none" ? undefined : props.sortDirection);
          }}
        >
          <option value="none">No sort</option>
          <option value="time">Time</option>
          <option value="name">Name</option>
          <option value="operation">Operation</option>
          <option value="status">Status</option>
        </select>
        <div className={transferStyles.sortDirection}>
          <button
            type="button"
            className={`${transferStyles.smallButton} ${props.sortKey !== "none" && props.sortDirection === "asc" ? transferStyles.sortButtonSelected : ""}`}
            disabled={props.sortKey === "none"}
            onClick={() => {
              if (props.sortKey !== "none") props.onSort(props.sortKey, "asc");
            }}
          >
            Asc
          </button>
          <button
            type="button"
            className={`${transferStyles.smallButton} ${props.sortKey !== "none" && props.sortDirection === "desc" ? transferStyles.sortButtonSelected : ""}`}
            disabled={props.sortKey === "none"}
            onClick={() => {
              if (props.sortKey !== "none") props.onSort(props.sortKey, "desc");
            }}
          >
            Desc
          </button>
        </div>
      </FilterSection>
    </div>
  );
}

function FilterSection(props: { title: string; children: ReactNode }) {
  return (
    <section className={transferStyles.filterSection}>
      <h3 className={transferStyles.filterSectionTitle}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function TransferDetail(props: {
  transfer: TransferRecord | null;
  operation?: OperationDescriptor;
  working: boolean;
  historyWorking: boolean;
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDelete: (transferId: number) => void;
}) {
  const row = props.transfer;
  if (!row) {
    return (
      <div className={transferStyles.detailEmpty}>
        <h3 className={transferStyles.detailTitle}>Transfer Detail</h3>
        <p>Select a transfer to inspect endpoints, progress, and status.</p>
      </div>
    );
  }
  return (
    <div className={transferStyles.detailContent}>
      <header className={transferStyles.detailHeader}>
        <h3 className={transferStyles.detailTitle}>{primaryTransferLabel(row)}</h3>
        <span className={statusBadgeClass(row.status)}>{prettyLabel(row.status)}</span>
      </header>
      <DetailRow label="Operation" value={prettyLabel(row.transferType)} />
      <DetailRow label="Provider" value={remoteSummary(row)} />
      <DetailRow label="Source" value={sourceEndpoint(row) || "--"} />
      <DetailRow label="Destination" value={targetEndpoint(row) || "--"} />
      <DetailRow label="Progress" value={`${transferProgress(row)} · ${row.transferredBytes} / ${row.totalBytes} bytes`} />
      <DetailRow label="Queued" value={timestampLabel(row.queuedAtMs)} />
      <DetailRow label="Started" value={timestampLabel(row.startedAtMs)} />
      <DetailRow label="Completed" value={timestampLabel(row.completedAtMs)} />
      <DetailRow label="Job ID" value={`J-${row.jobId}`} />
      {row.detailMessage ? <DetailRow label="Detail" value={row.detailMessage} /> : null}
      {row.errorMessage ? <DetailRow label="Error" value={row.errorMessage} danger /> : null}
      <div className={transferStyles.detailActions}>
        {props.operation?.cancelable ? (
          <button
            className={transferStyles.smallButton}
            type="button"
            disabled={props.working}
            onClick={() => void props.onCancel(props.operation!.operationId)}
          >
            Cancel
          </button>
        ) : null}
        {props.operation?.retryable && props.operation.status === "failed" ? (
          <button
            className={transferStyles.smallButton}
            type="button"
            disabled={props.working}
            onClick={() => void props.onRetry(props.operation!.operationId)}
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={transferStyles.detailRow}>
      <span className={transferStyles.detailLabel}>{props.label}</span>
      <strong className={props.danger ? transferStyles.detailDangerValue : transferStyles.detailValue}>{props.value}</strong>
    </div>
  );
}

function transferProviderGroups(rows: TransferRecord[], labels: Map<string, string>): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const provider of transferProviders(row)) {
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, label: labels.get(key) ?? key }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function filterTransferSearch(rows: TransferRecord[], query: string): TransferRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) => {
    const haystack = [
      row.fileName,
      row.jobId,
      row.transferType,
      row.itemType,
      row.status,
      row.localSourcePath,
      row.localDestPath,
      row.remoteSourceName,
      row.remoteSourcePath,
      row.remoteDestName,
      row.remoteDestPath,
      row.errorMessage,
      row.detailMessage,
      sourceEndpoint(row),
      targetEndpoint(row),
    ].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });
}

function filterAndSortTransfers(
  rows: TransferRecord[],
  filters: {
    providerFilters: Set<string>;
    typeFilters: Set<TransferType>;
    locationScope: string;
    statusFilter: "all" | "active" | "completed" | "failed";
    sortKey: TransferSortKey;
    sortDirection: TransferSortDirection;
  },
): TransferRecord[] {
  const filtered = rows.filter((row) => {
    if (filters.typeFilters.size > 0 && !filters.typeFilters.has(row.transferType)) return false;
    if (!transferStatusMatchesFilter(row.status, filters.statusFilter)) return false;
    const providers = transferProviders(row);
    if (filters.providerFilters.size > 0 && !providers.some((provider) => filters.providerFilters.has(provider))) return false;
    if (filters.locationScope === "local" && providers.length > 0) return false;
    if (filters.locationScope === "remote" && providers.length === 0) return false;
    return true;
  });

  const sortKey = filters.sortKey;
  if (sortKey === "none") return filtered;
  const direction = filters.sortDirection === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => direction * compareTransfers(left, right, sortKey));
}

function compareTransfers(left: TransferRecord, right: TransferRecord, key: TransferSortableKey): number {
  if (key === "name") return primaryTransferLabel(left).localeCompare(primaryTransferLabel(right));
  if (key === "operation") return left.transferType.localeCompare(right.transferType);
  if (key === "status") return left.status.localeCompare(right.status);
  return transferTime(left) - transferTime(right);
}

function transferProviders(row: TransferRecord): string[] {
  return [...new Set([row.remoteSourceName, row.remoteDestName].filter(Boolean))];
}

function transferTime(row: TransferRecord): number {
  return row.completedAtMs || row.startedAtMs || row.queuedAtMs || 0;
}

function primaryTransferLabel(row: TransferRecord): string {
  if (row.fileName) return row.fileName;
  const target = targetEndpoint(row);
  if (target && row.transferType !== "delete") return basename(target);
  return basename(sourceEndpoint(row)) || "Transfer";
}

function secondaryTransferLabel(row: TransferRecord): string {
  const source = sourceEndpoint(row);
  const target = targetEndpoint(row);
  if (source && target) return `${source} -> ${target}`;
  return source || target || "--";
}

function sourceEndpoint(row: TransferRecord): string {
  if (row.remoteSourceName) return `${row.remoteSourceName}:${row.remoteSourcePath || "/"}`;
  return row.localSourcePath;
}

function targetEndpoint(row: TransferRecord): string {
  if (row.remoteDestName) return `${row.remoteDestName}:${row.remoteDestPath || "/"}`;
  return row.localDestPath;
}

function basename(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const separator = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const colon = clean.lastIndexOf(":");
  const index = Math.max(separator, colon);
  return index >= 0 ? clean.slice(index + 1) : clean;
}

function timestampLabel(timestamp: number): string {
  if (!timestamp) return "--";
  return new Date(timestamp).toLocaleString();
}

function sortIndicator(activeKey: TransferSortKey, direction: TransferSortDirection, key: TransferSortableKey): string {
  if (activeKey !== key) return "";
  return direction === "asc" ? "↑" : "↓";
}

function statusBadgeClass(status: string): string {
  if (status === "completed") return `${transferStyles.statusBadge} ${transferStyles.statusCompleted}`;
  if (status === "failed" || status === "canceled" || status === "interrupted") {
    return `${transferStyles.statusBadge} ${transferStyles.statusFailed}`;
  }
  if (status === "queued" || status === "pending" || status === "in_progress" || status === "waiting_for_resolution") {
    return `${transferStyles.statusBadge} ${transferStyles.statusActive}`;
  }
  return transferStyles.statusBadge;
}

function tableStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "failed" || status === "canceled" || status === "interrupted") return "Failed";
  if (status === "queued" || status === "pending" || status === "in_progress" || status === "waiting_for_resolution") return "Pending";
  return prettyLabel(status);
}

function canPauseResumeOperation(operation: OperationDescriptor): boolean {
  return operation.paused
    || operation.status === "queued"
    || operation.status === "waiting_for_resolution";
}

function isTransferTableColumn(value: string): value is TransferTableColumn {
  return transferTableColumns.includes(value as TransferTableColumn);
}

function loadTransferColumnWidths(): TransferColumnWidths {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRANSFER_COLUMN_WIDTHS_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return { ...transferDefaultColumnWidths };
    const widths = { ...transferDefaultColumnWidths };
    for (const column of transferTableColumns) {
      const value = Number((parsed as Partial<Record<TransferTableColumn, unknown>>)[column]);
      if (Number.isFinite(value)) {
        widths[column] = Math.max(transferMinimumColumnWidths[column], Math.min(640, value));
      }
    }
    return widths;
  } catch {
    return { ...transferDefaultColumnWidths };
  }
}

function saveTransferColumnWidths(widths: TransferColumnWidths): void {
  window.localStorage.setItem(TRANSFER_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
}

function loadTransferColumnOrder(): TransferTableColumn[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRANSFER_COLUMN_ORDER_STORAGE_KEY) ?? "[]");
    const unique = Array.isArray(parsed)
      ? parsed.filter((value, index): value is TransferTableColumn =>
          typeof value === "string"
          && isTransferTableColumn(value)
          && parsed.indexOf(value) === index,
        )
      : [];
    const missing = transferTableColumns.filter((column) => !unique.includes(column));
    return unique.length > 0 ? [...unique, ...missing] : [...transferTableColumns];
  } catch {
    return [...transferTableColumns];
  }
}

function saveTransferColumnOrder(order: TransferTableColumn[]): void {
  window.localStorage.setItem(TRANSFER_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(order));
}

function loadTransferPanelVisibility(): { filters: boolean; detail: boolean } {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRANSFER_PANEL_VISIBILITY_STORAGE_KEY) ?? "{}") as Partial<{ filters: boolean; detail: boolean }>;
    return {
      filters: typeof parsed.filters === "boolean" ? parsed.filters : true,
      detail: typeof parsed.detail === "boolean" ? parsed.detail : true,
    };
  } catch {
    return { filters: true, detail: true };
  }
}

function saveTransferPanelVisibility(visibility: { filters: boolean; detail: boolean }): void {
  try {
    window.localStorage.setItem(TRANSFER_PANEL_VISIBILITY_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // Transfers remains usable if localStorage is disabled.
  }
}

function OperationQueueStrip(props: { onQueueChanged: () => void }) {
  const { snapshot, working, error, load, cancel, cancelBatch, pause, resume, pauseBatch, resumeBatch, pauseAll, resumeAll, setPriority, setBandwidthLimit, setTransferProfile, retry, redo, resolveConflict, clearTerminal } = useOperationQueueStore(useShallow((state) => ({
    snapshot: state.snapshot,
    working: state.working,
    error: state.error,
    load: state.load,
    cancel: state.cancel,
    cancelBatch: state.cancelBatch,
    pause: state.pause,
    resume: state.resume,
    pauseBatch: state.pauseBatch,
    resumeBatch: state.resumeBatch,
    pauseAll: state.pauseAll,
    resumeAll: state.resumeAll,
    setPriority: state.setPriority,
    setBandwidthLimit: state.setBandwidthLimit,
    setTransferProfile: state.setTransferProfile,
    retry: state.retry,
    redo: state.redo,
    resolveConflict: state.resolveConflict,
    clearTerminal: state.clearTerminal,
  })));
  const [refreshSpinning, startRefreshSpin] = useMinimumSpin(working);
  const settingsDocument = useSettingsStore((state) => state.settings?.document ?? {});
  const transferProfiles = useMemo(() => transferProfileRecords(settingsDocument), [settingsDocument]);
  const operations = snapshot?.operations ?? [];
  const active = operations.filter((operation) => operation.status === "queued" || operation.status === "in_progress" || operation.status === "waiting_for_resolution");
  const terminal = operations.length - active.length;
  const activeBatches = useMemo(() => {
    const activeBatchIds = new Set(active.map((operation) => operation.batchId));
    return (snapshot?.batches ?? []).filter((batch) => activeBatchIds.has(batch.batchId));
  }, [active, snapshot?.batches]);
  const conflict = snapshot?.conflictDialog;
  const conflictBatch = conflict?.open ? snapshot?.batches.find((batch) => batch.batchId === conflict.batchId) : null;
  const canApplyConflictToBatch = Boolean(conflictBatch && conflictBatch.operationIds.length > 1);
  const canCancelConflictBatch = Boolean(
    conflictBatch
      && conflictBatch.operationIds.length > 1
      && operations.some((operation) => (
        operation.batchId === conflictBatch.batchId
        && operation.cancelable
      )),
  );
  const [applyConflictToBatch, setApplyConflictToBatch] = useState(conflict?.applyToBatch ?? true);
  const [bandwidthDraft, setBandwidthDraft] = useState(snapshot?.bandwidthLimit ?? "");

  useEffect(() => {
    if (conflict?.open) {
      setApplyConflictToBatch(conflict.applyToBatch);
    }
  }, [conflict?.operationId, conflict?.applyToBatch, conflict?.open]);
  useEffect(() => {
    setBandwidthDraft(snapshot?.bandwidthLimit ?? "");
  }, [snapshot?.bandwidthLimit]);
  const runQueueMutation = useCallback(async (action: Promise<void>) => {
    await action;
    props.onQueueChanged();
  }, [props.onQueueChanged]);
  const applyBandwidthLimit = useCallback(() => {
    void runQueueMutation(setBandwidthLimit(bandwidthDraft.trim()));
  }, [bandwidthDraft, runQueueMutation, setBandwidthLimit]);
  const applyTransferProfile = useCallback((profileId: string) => {
    const profile = transferProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    setBandwidthDraft(profile.bandwidthLimit);
    void runQueueMutation(setTransferProfile(profile));
  }, [runQueueMutation, setTransferProfile, transferProfiles]);

  return (
    <section className={transferStyles.operationStrip}>
      <div className={transferStyles.operationSummary}>
        <strong className={transferStyles.operationTitle}>Operation Queue</strong>
        <span className={transferStyles.operationMeta}>
          {snapshot ? `${active.length} active · ${terminal} finished · ${snapshot.maxConcurrent} max` : "Not loaded"}
        </span>
      </div>
      <div className={transferStyles.operationActions}>
        {error ? <span className="error-text">{error}</span> : null}
        <button
          className={transferStyles.operationButton}
          type="button"
          onClick={() => {
            startRefreshSpin();
            void load();
          }}
          disabled={working}
        >
          <RefreshCcw className={refreshSpinning ? "animate-spin" : undefined} size={14} />
          Refresh
        </button>
        <button
          className={transferStyles.operationButton}
          type="button"
          onClick={() => void runQueueMutation(snapshot?.paused ? resumeAll() : pauseAll())}
          disabled={working || !snapshot}
        >
          {snapshot?.paused ? <Play size={14} /> : <Pause size={14} />}
          {snapshot?.paused ? "Resume All" : "Pause All"}
        </button>
        <select
          className={transferStyles.operationInput}
          value={snapshot?.transferProfileId ?? ""}
          aria-label="Transfer profile"
          onChange={(event) => applyTransferProfile(event.target.value)}
          disabled={working || !snapshot || transferProfiles.length === 0}
        >
          {transferProfiles.length === 0 ? (
            <option value="">Profiles unavailable</option>
          ) : null}
          {transferProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <input
          className={transferStyles.operationInput}
          value={bandwidthDraft}
          placeholder="Bandwidth"
          aria-label="Bandwidth limit"
          onChange={(event) => setBandwidthDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyBandwidthLimit();
          }}
        />
        <button className={transferStyles.operationButton} type="button" onClick={applyBandwidthLimit} disabled={working || !snapshot}>
          Apply Limit
        </button>
        <button className={transferStyles.operationButton} type="button" onClick={() => void runQueueMutation(redo())} disabled={working || !snapshot?.redoAvailable}>
          <RotateCcw size={14} />
          Redo
        </button>
        <button className={transferStyles.operationButton} type="button" onClick={() => void runQueueMutation(clearTerminal())} disabled={working || terminal === 0}>
          <Trash2 size={14} />
          Clear Finished
        </button>
      </div>
      {conflict?.open ? (
        <div className={transferStyles.conflictRow}>
          <div className={transferStyles.conflictMain}>
            <strong className={transferStyles.operationTitle}>{conflict.title || "Resolve conflict"}</strong>
            <span className={transferStyles.conflictText}>{conflict.sourceLabel} → {conflict.targetLabel}</span>
          </div>
          <label className={transferStyles.conflictApply}>
            <input
              className={transferStyles.conflictCheckbox}
              type="checkbox"
              checked={canApplyConflictToBatch && applyConflictToBatch}
              disabled={working || !canApplyConflictToBatch}
              onChange={(event) => setApplyConflictToBatch(event.currentTarget.checked)}
            />
            <span>Apply to batch</span>
          </label>
          <button
            className={transferStyles.operationButton}
            type="button"
            disabled={working}
            onClick={() => void runQueueMutation(cancel(conflict.operationId))}
          >
            Cancel
          </button>
          {conflictBatch ? (
            <button
              className={transferStyles.operationButton}
              type="button"
              disabled={working || !canCancelConflictBatch}
              onClick={() => void runQueueMutation(cancelBatch(conflictBatch.batchId))}
            >
              Cancel Batch
            </button>
          ) : null}
          {conflict.supportsReplace ? (
            <button className={transferStyles.operationButton} type="button" disabled={working} onClick={() => void runQueueMutation(resolveConflict(conflict.operationId, "replace", canApplyConflictToBatch && applyConflictToBatch))}>
              Replace
            </button>
          ) : null}
          <button className={transferStyles.operationButton} type="button" disabled={working} onClick={() => void runQueueMutation(resolveConflict(conflict.operationId, "skip", canApplyConflictToBatch && applyConflictToBatch))}>
            Skip
          </button>
          {conflict.supportsKeepBoth ? (
            <button className={transferStyles.operationButton} type="button" disabled={working} onClick={() => void runQueueMutation(resolveConflict(conflict.operationId, "keep_both", canApplyConflictToBatch && applyConflictToBatch))}>
              Keep Both
            </button>
          ) : null}
        </div>
      ) : null}
      {activeBatches.length > 0 ? (
        <div className={transferStyles.operationActions}>
          {activeBatches.slice(0, 3).map((batch) => (
            <span key={batch.batchId} className={transferStyles.operationActions}>
              <span className={transferStyles.operationMeta}>{batch.label || `Batch ${batch.batchId}`}</span>
              <button
                className={transferStyles.operationButton}
                type="button"
                disabled={working}
                onClick={() => void runQueueMutation(batch.paused ? resumeBatch(batch.batchId) : pauseBatch(batch.batchId))}
              >
                {batch.paused ? <Play size={14} /> : <Pause size={14} />}
                {batch.paused ? "Resume Batch" : "Pause Batch"}
              </button>
              <button
                className={transferStyles.operationButton}
                type="button"
                disabled={working}
                onClick={() => void runQueueMutation(cancelBatch(batch.batchId))}
              >
                <XCircle size={14} />
                Cancel Batch
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {operations.length > 0 ? (
        <div className={transferStyles.operationList}>
          {operations.slice(0, 5).map((operation) => (
            <div key={operation.operationId} className={transferStyles.operationRow}>
              <span className={transferStyles.operationCell}>{operation.title || prettyLabel(operation.kind)}</span>
              <span className={statusBadgeClass(operation.status)}>{prettyLabel(operation.status)}</span>
              <span className={transferStyles.operationCell}>{operation.source.localPath || `${operation.source.remoteName}:${operation.source.remotePath}`}</span>
              <span className={transferStyles.operationCell}>{operation.target.localPath || `${operation.target.remoteName}:${operation.target.remotePath}`}</span>
              <select
                className={transferStyles.operationSelect}
                aria-label="Operation priority"
                value={operation.priority}
                disabled={working}
                onChange={(event) => void runQueueMutation(setPriority(operation.operationId, event.target.value as OperationPriority))}
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
              <button
                className={transferStyles.operationButton}
                type="button"
                disabled={working || !canPauseResumeOperation(operation)}
                onClick={() => void runQueueMutation(operation.paused ? resume(operation.operationId) : pause(operation.operationId))}
              >
                {operation.paused ? <Play size={14} /> : <Pause size={14} />}
                {operation.paused ? "Resume" : "Pause"}
              </button>
              <button className={transferStyles.operationButton} type="button" disabled={!operation.cancelable || working} onClick={() => void runQueueMutation(cancel(operation.operationId))}>
                <XCircle size={14} />
                Cancel
              </button>
              <button className={transferStyles.operationButton} type="button" disabled={!operation.retryable || operation.status !== "failed" || working} onClick={() => void runQueueMutation(retry(operation.operationId))}>
                <RotateCcw size={14} />
                Retry
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
