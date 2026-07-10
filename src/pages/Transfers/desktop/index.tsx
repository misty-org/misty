import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import type { OperationDescriptor, TransferRecord, TransferType } from "../../../api/types";
import { errorText, prettyLabel } from "../../../shared/format";
import { MultiPanelWorkspace } from "../../../shared/multipanel/MultiPanelWorkspace";
import type { MultiPanelClosedPane, MultiPanelTab } from "../../../shared/multipanel/types";
import { createMultiPanelStore, type MultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { useProvidersStore } from "../../../stores/useProvidersStore";
import { relativeTime, remoteSummary } from "../transferUtils";
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
type TransferTreeRow = {
  row: TransferRecord;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};
type TransferProgressSnapshot = {
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  aggregated: boolean;
};
type TransferActionFeedback = {
  tone: "busy" | "success" | "error";
  text: string;
} | null;
type ViewportMenuPosition = {
  left: number;
  top: number;
  maxHeight: number;
};

const transferTableColumns: TransferTableColumn[] = ["transfer", "operation", "status", "time", "remote", "actions"];
const transferColumnLabels: Record<TransferTableColumn, string> = {
  transfer: "Name",
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
const emptyQueueOperations: OperationDescriptor[] = [];
const transferDefaultColumnWidths: TransferColumnWidths = {
  transfer: 280,
  operation: 135,
  status: 135,
  time: 130,
  remote: 180,
  actions: 185,
};
const transferMinimumColumnWidths: TransferColumnWidths = {
  transfer: 190,
  operation: 110,
  status: 110,
  time: 105,
  remote: 140,
  actions: 172,
};
const TRANSFERS_MULTIPANEL_STORAGE_KEY = "misty.transfers.multipanel.v1";
const TRANSFER_COLUMN_WIDTHS_STORAGE_KEY = "misty.transfers.table.columnWidths";
const TRANSFER_COLUMN_ORDER_STORAGE_KEY = "misty.transfers.table.columnOrder";
const TRANSFER_PANEL_VISIBILITY_STORAGE_KEY = "misty.transfers.panelVisibility";
const TRANSFER_ROW_HEIGHT = 46;
const TRANSFER_OVERSCAN_ROWS = 8;
const VIEWPORT_MENU_MARGIN = 8;

const transferStyles = {
  workspace:
    "bg-[var(--misty-app-page-bg,var(--misty-bg))]",
  pane:
    "grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_24px] overflow-hidden bg-transparent",
  toolbar:
    "relative flex min-w-0 items-center justify-end gap-2 border-b border-transparent bg-transparent px-2 py-2",
  toolbarButton:
    "inline-flex min-h-[38px] items-center gap-[7px] rounded-[10px] border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] px-[11px] py-2 text-[var(--misty-text)]",
  iconToolbarButton:
    "grid size-8 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] p-0 text-[var(--misty-text)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] disabled:opacity-45",
  toolbarDanger:
    "border-[color-mix(in_srgb,var(--misty-danger)_42%,var(--misty-border))] text-[var(--misty-danger)]",
  searchBox:
    "!flex !h-8 w-[min(340px,34vw)] min-w-52 !items-center !gap-2 rounded-lg border border-[var(--misty-border)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] px-2.5 text-[var(--misty-text-muted)] !normal-case [&>input]:!h-full [&>input]:!min-w-0 [&>input]:!flex-1 [&>input]:!rounded-none [&>input]:!border-0 [&>input]:!bg-transparent [&>input]:!p-0 [&>input]:!text-sm [&>input]:!leading-none [&>input]:!text-[var(--misty-text)] [&>input]:!shadow-none [&>input]:!outline-none [&>input]:placeholder:!text-[var(--misty-text-subtle)]",
  actionFeedback:
    "mr-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2 py-1 text-xs",
  actionFeedbackBusy:
    "bg-[color-mix(in_srgb,var(--misty-accent)_12%,var(--misty-surface))] text-[var(--misty-accent)]",
  actionFeedbackSuccess:
    "bg-[color-mix(in_srgb,var(--misty-success)_12%,var(--misty-surface))] text-[var(--misty-success)]",
  actionFeedbackError:
    "bg-[color-mix(in_srgb,var(--misty-danger)_12%,var(--misty-surface))] text-[var(--misty-danger)]",
  sortMenu:
    "fixed z-[2147483000] grid w-44 gap-1 overflow-y-auto rounded-[10px] border border-[var(--misty-border)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] p-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.38)]",
  sortMenuLabel:
    "px-2.5 py-1 text-[11px] font-bold uppercase text-[var(--misty-text-subtle)]",
  sortMenuItem:
    "flex h-8 min-w-0 items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-sm text-[var(--misty-text)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))]",
  sortMenuItemActive:
    "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-3))]",
  sortMenuIcon:
    "grid size-4 shrink-0 place-items-center text-[var(--misty-text-muted)]",
  actionMenu:
    "fixed z-[2147483000] grid w-52 gap-1 overflow-y-auto rounded-[10px] border border-[var(--misty-border)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] p-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.38)]",
  actionMenuItem:
    "flex h-8 min-w-0 items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 text-left text-sm text-[var(--misty-text)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] disabled:opacity-45",
  actionMenuField:
    "grid min-w-0 gap-1 rounded-lg px-2.5 py-1.5",
  actionMenuFieldLabel:
    "text-[11px] font-semibold uppercase text-[var(--misty-text-subtle)]",
  actionMenuDanger:
    "text-[var(--misty-danger)]",
  actionMenuSeparator: "my-1 h-px bg-[var(--misty-border-soft)]",
  activeFilterPill:
    "inline-flex min-h-[38px] items-center gap-[7px] whitespace-nowrap rounded-full border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] px-[11px] py-[7px] text-[var(--misty-text-muted)]",
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
    "min-h-0 min-w-0 overflow-hidden border-r border-[var(--misty-border-soft)] bg-transparent last:border-r-0",
  listPanel:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-r border-[var(--misty-border-soft)] bg-transparent",
  listPanelNoRight:
    "border-r-0",
  pagination:
    "flex min-w-0 items-center justify-between gap-2 border-t border-[var(--misty-border-soft)] px-2 py-1.5 text-xs text-[var(--misty-text-muted)]",
  paginationButtons: "flex gap-1.5",
  paginationButton:
    "min-h-[26px] rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] px-2.5 py-1 text-[var(--misty-text)] disabled:opacity-40",
  contentScroll: "h-full overflow-auto p-3",
  filterHeading: "mb-3 flex items-center justify-between gap-2.5",
  filterTitle: "text-sm font-semibold text-[var(--misty-text)]",
  smallButton:
    "min-h-[30px] rounded-[9px] border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] px-[9px] py-[5px] text-[var(--misty-text)] disabled:opacity-45",
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
    "w-full rounded-lg border border-[var(--misty-border)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] px-2.5 py-2 text-[var(--misty-text)]",
  sortDirection: "grid grid-cols-2 gap-2",
  sortButtonSelected:
    "border-[var(--misty-accent)] bg-[color-mix(in_srgb,var(--misty-accent)_16%,var(--misty-surface))]",
  tableWrap:
    "h-full min-h-0 overflow-auto p-0 pr-3 [overscroll-behavior:contain] [scrollbar-gutter:stable_both-edges]",
  table: "select-none border-collapse table-fixed",
  tableHeader:
    "sticky top-0 z-[2] select-none border-b border-[var(--misty-border-soft)] bg-transparent px-2.5 py-2 text-left align-middle text-[13px] font-semibold leading-none text-[var(--misty-text-muted)]",
  tableHeaderDragging: "opacity-60",
  tableHeaderControl:
    "inline-block min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 align-middle font-[inherit] text-inherit",
  tableResizeHandle:
    "absolute right-[-3px] top-0 z-[3] h-full w-[7px] cursor-col-resize hover:bg-[rgba(79,141,255,0.34)]",
  tableRow:
    "group h-[46px] cursor-default select-none hover:bg-[color-mix(in_srgb,var(--misty-surface-3)_76%,transparent)]",
  tableRowFocused:
    "bg-[color-mix(in_srgb,var(--misty-accent)_14%,var(--misty-surface))]",
  tableRowSelected:
    "bg-[color-mix(in_srgb,var(--misty-accent)_18%,var(--misty-surface))]",
  tableCell:
    "min-w-0 select-none overflow-hidden text-ellipsis whitespace-nowrap border-b border-[var(--misty-border-soft)] px-2.5 py-1.5 text-left align-middle text-[13px] leading-[16px]",
  nameCellContent: "flex min-w-0 items-center gap-1.5",
  treeToggle:
    "grid size-5 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] hover:text-[var(--misty-text)]",
  treeSpacer: "block size-5 shrink-0",
  nameText: "min-w-0 flex-1 overflow-hidden",
  tablePrimary: "block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold leading-[17px]",
  tableSecondary:
    "mt-px block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-[15px] text-[var(--misty-text-subtle)]",
  rowActions:
    "flex h-full items-center justify-end gap-2 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100",
  rowActionsVisible: "opacity-100",
  rowActionGroup:
    "inline-flex h-[30px] overflow-hidden rounded-[8px] border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))]",
  rowActionIconButton:
    "grid h-[28px] w-[30px] place-items-center border-0 border-r border-[var(--misty-border-soft)] bg-transparent p-0 text-[var(--misty-text)] last:border-r-0 hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-3))] disabled:text-[var(--misty-text-subtle)] disabled:opacity-40",
  rowActionDangerButton:
    "grid h-[30px] w-[32px] place-items-center rounded-[8px] border border-[color-mix(in_srgb,var(--misty-danger)_42%,var(--misty-border))] bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] p-0 text-[var(--misty-danger)] hover:bg-[color-mix(in_srgb,var(--misty-danger)_12%,var(--misty-surface-2))] disabled:opacity-40",
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
  progressTrack:
    "h-2 overflow-hidden rounded-full bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))]",
  progressFill:
    "h-full rounded-full bg-[var(--misty-accent)] transition-[width] duration-200",
  progressFillUnknown:
    "w-1/3 bg-[color-mix(in_srgb,var(--misty-accent)_56%,var(--misty-surface-3))]",
  progressMeta:
    "flex min-w-0 items-center justify-between gap-2 text-xs text-[var(--misty-text-subtle)]",
  progressMetaStrong:
    "font-medium text-[var(--misty-text)]",
  statusBadge:
    "inline-flex w-fit rounded-full bg-[var(--misty-app-surface-soft-bg,var(--misty-surface-2))] px-2 py-[3px] text-xs leading-4 text-[var(--misty-text-muted)] capitalize",
  statusCompleted:
    "bg-[color-mix(in_srgb,var(--misty-success)_15%,var(--misty-surface))] text-[var(--misty-success)]",
  statusFailed:
    "bg-[color-mix(in_srgb,var(--misty-danger)_14%,var(--misty-surface))] text-[var(--misty-danger)]",
  statusActive:
    "bg-[color-mix(in_srgb,var(--misty-accent)_14%,var(--misty-surface))] text-[var(--misty-accent)]",
  operationSelect:
    "h-[30px] rounded-[7px] border border-[var(--misty-border-soft)] bg-[var(--misty-app-surface-bg,var(--misty-surface))] px-2 text-xs text-[var(--misty-text)] outline-none",
  bottomBar:
    "flex min-w-0 items-center justify-between border-t border-transparent bg-transparent px-2",
  bottomBarSide: "flex min-w-0 items-center gap-1",
  bottomButton:
    "grid h-5 w-[22px] place-items-center rounded border-0 bg-transparent p-0 text-[var(--misty-text-muted)] hover:bg-[var(--misty-neutral-hover-bg,var(--misty-surface-2))] hover:text-[var(--misty-text)]",
  bottomButtonSelected:
    "bg-[var(--misty-neutral-selected-bg,var(--misty-surface-2))] text-[var(--misty-text)]",
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
    selectTransfer,
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
    selectTransfer: state.selectTransfer,
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
  const cancelBatch = useOperationQueueStore((state) => state.cancelBatch);
  const pauseOperation = useOperationQueueStore((state) => state.pause);
  const resumeOperation = useOperationQueueStore((state) => state.resume);
  const pauseBatch = useOperationQueueStore((state) => state.pauseBatch);
  const resumeBatch = useOperationQueueStore((state) => state.resumeBatch);
  const retryOperation = useOperationQueueStore((state) => state.retry);
  const retryTransfer = useOperationQueueStore((state) => state.retryTransfer);
  const resolveConflict = useOperationQueueStore((state) => state.resolveConflict);
  const undoOperation = useOperationQueueStore((state) => state.undo);

  useEffect(() => {
    ensureWorkspace(props.workspaceId);
    void load();
    void loadQueue();
  }, [ensureWorkspace, load, loadQueue, props.workspaceId]);

  useEffect(() => {
    if (!providerSnapshot) void loadProviders(false);
  }, [loadProviders, providerSnapshot]);

  const refreshTransferViews = useCallback(async (options: { force?: boolean } = {}) => {
    await Promise.all([
      load(undefined, { silent: true, force: options.force }),
      useOperationQueueStore.getState().load({ silent: true, force: options.force }),
    ]);
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
  const treeInputRows = useMemo(
    () => includeTransferAncestors(filteredRows, rows),
    [filteredRows, rows],
  );
  const [expandedTransferIds, setExpandedTransferIds] = useState<Set<number>>(() => new Set());
  const treeRows = useMemo(
    () => buildTransferTreeRows(treeInputRows, expandedTransferIds),
    [expandedTransferIds, treeInputRows],
  );
  const pageCount = Math.max(1, Math.ceil(treeRows.length / TRANSFERS_PAGE_SIZE));
  const activePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageRows = treeRows.slice(
    activePageIndex * TRANSFERS_PAGE_SIZE,
    (activePageIndex + 1) * TRANSFERS_PAGE_SIZE,
  );
  useEffect(() => {
    if (activePageIndex !== pageIndex) setPageIndex(props.workspaceId, activePageIndex);
  }, [activePageIndex, pageIndex, props.workspaceId, setPageIndex]);
  const focusedTransfer = treeInputRows.find((row) => row.id === focusedTransferId) ?? treeInputRows[0] ?? null;
  const activeFilterCount = activeTransferFilterCount({ providerFilters, typeFilters, locationScope, statusFilter });
  const queueOperationsByTransfer = useMemo(() => {
    const operations = new Map<number, NonNullable<typeof queueSnapshot>["operations"][number]>();
    for (const operation of queueSnapshot?.operations ?? []) {
      if (operation.transferId) operations.set(operation.transferId, operation);
    }
    return operations;
  }, [queueSnapshot?.operations]);
  const hasLiveTransferWork = useMemo(
    () => rows.some(isLiveTransfer) || (queueSnapshot?.activeCount ?? 0) > 0,
    [queueSnapshot?.activeCount, rows],
  );
  useEffect(() => {
    const intervalMs = hasLiveTransferWork ? 1000 : 5000;
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void refreshTransferViews();
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [hasLiveTransferWork, refreshTransferViews]);
  const [actionMenu, setActionMenu] = useState<TransferActionMenuState>(null);
  const actionMenuTransfer = actionMenu?.rowId ? rows.find((row) => row.id === actionMenu.rowId) ?? null : null;
  const actionMenuOperation = actionMenuTransfer ? queueOperationsByTransfer.get(actionMenuTransfer.id) : undefined;
  const actionMenuBatch = actionMenuTransfer?.batchId
    ? queueSnapshot?.batches.find((batch) => batch.batchId === actionMenuTransfer.batchId)
    : undefined;
  const visibleTransferIds = useMemo(() => pageRows.map((entry) => entry.row.id), [pageRows]);
  const selectedCount = selectedIds.size;
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollFrameRef = useRef<number | null>(null);
  const tableViewportHeightRef = useRef(0);
  const tableScrollTopRef = useRef(0);
  const actionFeedbackTimerRef = useRef<number | null>(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<TransferActionFeedback>(null);
  const [columnWidths, setColumnWidths] = useState<TransferColumnWidths>(loadTransferColumnWidths);
  const [columnOrder, setColumnOrder] = useState<TransferTableColumn[]>(loadTransferColumnOrder);
  const [draggedColumn, setDraggedColumn] = useState<TransferTableColumn | null>(null);
  const [panelVisibility, setPanelVisibility] = useState(loadTransferPanelVisibility);
  const [sortMenu, setSortMenu] = useState<TransferSortMenuState>(null);
  const filtersVisible = panelVisibility.filters;
  const detailVisible = panelVisibility.detail;
  const visibleColumnOrder = useMemo(() => columnOrder.filter((column) => column !== "remote"), [columnOrder]);
  const tableWidth = visibleColumnOrder.reduce((sum, column) => sum + columnWidths[column], 0);
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
  useEffect(() => () => {
    if (actionFeedbackTimerRef.current !== null) {
      window.clearTimeout(actionFeedbackTimerRef.current);
    }
  }, []);
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
  const showActionFeedback = useCallback((feedback: TransferActionFeedback, autoClearMs = 2800) => {
    if (actionFeedbackTimerRef.current !== null) {
      window.clearTimeout(actionFeedbackTimerRef.current);
      actionFeedbackTimerRef.current = null;
    }
    setActionFeedback(feedback);
    if (feedback && feedback.tone !== "busy" && autoClearMs > 0) {
      actionFeedbackTimerRef.current = window.setTimeout(() => {
        setActionFeedback(null);
        actionFeedbackTimerRef.current = null;
      }, autoClearMs);
    }
  }, []);
  const refreshAfterQueueMutation = useCallback(async (
    action: Promise<void>,
    labels: { busy: string; success: string },
  ) => {
    showActionFeedback({ tone: "busy", text: labels.busy }, 0);
    try {
      await action;
      const queueError = useOperationQueueStore.getState().error;
      await refreshTransferViews({ force: true });
      if (queueError) {
        showActionFeedback({ tone: "error", text: queueError }, 6500);
        return;
      }
      showActionFeedback({ tone: "success", text: labels.success });
    } catch (error) {
      await refreshTransferViews({ force: true });
      showActionFeedback({ tone: "error", text: errorText(error) }, 6500);
    }
  }, [refreshTransferViews, showActionFeedback]);
  const handleUndo = useCallback((undoTokenId: number) => {
    void refreshAfterQueueMutation(undoOperation(undoTokenId), {
      busy: "Undoing transfer...",
      success: "Undo queued.",
    });
  }, [refreshAfterQueueMutation, undoOperation]);
  const handleCancelOperation = useCallback(
    (operationId: number) => refreshAfterQueueMutation(cancelOperation(operationId), {
      busy: "Canceling transfer...",
      success: "Cancel requested.",
    }),
    [cancelOperation, refreshAfterQueueMutation],
  );
  const handleRetryOperation = useCallback(
    (operationId: number) => refreshAfterQueueMutation(retryOperation(operationId), {
      busy: "Retrying transfer...",
      success: "Retry queued.",
    }),
    [refreshAfterQueueMutation, retryOperation],
  );
  const handlePauseResumeTransfer = useCallback(
    (transfer: TransferRecord) => {
      if (!transfer.operationId) return Promise.resolve();
      const resuming = transfer.paused;
      return refreshAfterQueueMutation(
        resuming
          ? resumeOperation(transfer.operationId)
          : pauseOperation(transfer.operationId),
        {
          busy: resuming ? "Resuming transfer..." : "Pausing transfer...",
          success: resuming ? "Transfer resumed." : "Pause requested.",
        },
      );
    },
    [pauseOperation, refreshAfterQueueMutation, resumeOperation],
  );
  const handlePauseResumeBatchTransfer = useCallback(
    (transfer: TransferRecord) => {
      if (!transfer.batchId) return Promise.resolve();
      const batch = queueSnapshot?.batches.find((candidate) => candidate.batchId === transfer.batchId);
      const resuming = Boolean(batch?.paused);
      return refreshAfterQueueMutation(
        resuming
          ? resumeBatch(transfer.batchId)
          : pauseBatch(transfer.batchId),
        {
          busy: resuming ? "Resuming batch..." : "Pausing batch...",
          success: resuming ? "Batch resumed." : "Batch paused.",
        },
      );
    },
    [pauseBatch, queueSnapshot?.batches, refreshAfterQueueMutation, resumeBatch],
  );
  const handleCancelBatchTransfer = useCallback(
    (transfer: TransferRecord) => {
      if (!transfer.batchId) return Promise.resolve();
      return refreshAfterQueueMutation(cancelBatch(transfer.batchId), {
        busy: "Canceling batch...",
        success: "Batch cancellation requested.",
      });
    },
    [cancelBatch, refreshAfterQueueMutation],
  );
  const handleResolveConflictTransfer = useCallback(
    (transfer: TransferRecord, policy: "replace" | "skip" | "keep_both", applyToBatch: boolean) => {
      if (!transfer.operationId) return Promise.resolve();
      return refreshAfterQueueMutation(resolveConflict(transfer.operationId, policy, applyToBatch), {
        busy: "Resolving conflict...",
        success: "Conflict resolved.",
      });
    },
    [refreshAfterQueueMutation, resolveConflict],
  );
  const handleCancelTransfer = useCallback(
    (transfer: TransferRecord) => {
      if (!transfer.operationId) return Promise.resolve();
      return handleCancelOperation(transfer.operationId);
    },
    [handleCancelOperation],
  );
  const handleRetryTransfer = useCallback(
    (transfer: TransferRecord) => {
      if (transfer.operationId) return handleRetryOperation(transfer.operationId);
      return refreshAfterQueueMutation(retryTransfer(transfer.id), {
        busy: "Retrying transfer...",
        success: "Retry queued.",
      });
    },
    [handleRetryOperation, refreshAfterQueueMutation, retryTransfer],
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
  const toggleTransferTree = useCallback((transferId: number) => {
    setExpandedTransferIds((current) => {
      const next = new Set(current);
      if (next.has(transferId)) {
        next.delete(transferId);
      } else {
        next.add(transferId);
      }
      return next;
    });
  }, []);
  const handleSelectTransfer = useCallback((row: TransferRecord, event: ReactMouseEvent) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) event.preventDefault();
    selectTransfer(props.workspaceId, row.id, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      visibleTransferIds,
    });
  }, [props.workspaceId, selectTransfer, visibleTransferIds]);
  const closeActionMenu = useCallback(() => setActionMenu(null), []);
  const closeSortMenu = useCallback(() => setSortMenu(null), []);
  useEffect(() => {
    if (!actionMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-transfer-action-menu]")) return;
      setActionMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionMenu(null);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionMenu]);
  useEffect(() => {
    if (!sortMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-transfer-sort-menu]")) return;
      setSortMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSortMenu(null);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
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
        batchPaused={Boolean(actionMenuBatch?.paused)}
        selectedCount={selectedCount}
        hasTransfers={Boolean(transfers && transfers.totalCount > 0)}
        historyWorking={working}
        queueWorking={queueWorking}
        onClose={closeActionMenu}
        onPauseResume={handlePauseResumeTransfer}
        onPauseResumeBatch={handlePauseResumeBatchTransfer}
        onCancelBatch={handleCancelBatchTransfer}
        onResolveConflict={handleResolveConflictTransfer}
        onCancel={handleCancelTransfer}
        onRetry={handleRetryTransfer}
        onUndo={handleUndo}
        onDeleteRow={handleDeleteTransfer}
        onDeleteSelected={handleDeleteSelected}
        onDeleteAll={handleDeleteAll}
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
              {actionFeedback ? (
                <span
                  className={[
                    transferStyles.actionFeedback,
                    actionFeedback.tone === "busy" ? transferStyles.actionFeedbackBusy : "",
                    actionFeedback.tone === "success" ? transferStyles.actionFeedbackSuccess : "",
                    actionFeedback.tone === "error" ? transferStyles.actionFeedbackError : "",
                  ].filter(Boolean).join(" ")}
                  role="status"
                  aria-live="polite"
                >
                  {actionFeedback.text}
                </span>
              ) : null}
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
                  {visibleColumnOrder.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
                </colgroup>
                <thead>
                  <tr>
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
                      <td colSpan={visibleColumnOrder.length} style={{ height: topSpacerHeight, padding: 0 }} />
                    </tr>
                  ) : null}
                  {visibleRows.map((entry) => {
                    const row = entry.row;
                    const operation = queueOperationsByTransfer.get(row.id);
                    return (
                      <TransferTableRow
                        key={row.id}
                        row={row}
                        treeDepth={entry.depth}
                        hasChildren={entry.hasChildren}
                        expanded={entry.expanded}
                        columnOrder={visibleColumnOrder}
                        operation={operation}
                        selected={selectedIds.has(row.id)}
                        focused={focusedTransfer?.id === row.id}
                        actionsVisible={actionMenu?.rowId === row.id}
                        queueWorking={queueWorking}
                        historyWorking={working}
                        onSelect={handleSelectTransfer}
                        onPauseResume={handlePauseResumeTransfer}
                        onResolveConflict={handleResolveConflictTransfer}
                        onCancel={handleCancelTransfer}
                        onRetry={handleRetryTransfer}
                        onUndo={handleUndo}
                        onDelete={handleDeleteTransfer}
                        onToggleTree={toggleTransferTree}
                        onOpenMenu={openRowActionMenu}
                        onContextMenu={openRowActionMenu}
                      />
                    );
                  })}
                  {bottomSpacerHeight > 0 ? (
                    <tr aria-hidden="true">
                      <td colSpan={visibleColumnOrder.length} style={{ height: bottomSpacerHeight, padding: 0 }} />
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
                rows={rows}
                operation={focusedTransfer ? queueOperationsByTransfer.get(focusedTransfer.id) : undefined}
                working={queueWorking}
                historyWorking={working}
                onCancel={handleCancelTransfer}
                onRetry={handleRetryTransfer}
                onPauseResume={handlePauseResumeTransfer}
                onPauseResumeBatch={handlePauseResumeBatchTransfer}
                onCancelBatch={handleCancelBatchTransfer}
                onResolveConflict={handleResolveConflictTransfer}
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

function useViewportMenuPosition(
  menu: TransferActionMenuState | TransferSortMenuState,
  menuRef: RefObject<HTMLDivElement | null>,
): ViewportMenuPosition {
  const [position, setPosition] = useState<ViewportMenuPosition>(() =>
    clampViewportMenuPosition(menu?.x ?? VIEWPORT_MENU_MARGIN, menu?.y ?? VIEWPORT_MENU_MARGIN, 0, 0));

  useLayoutEffect(() => {
    if (!menu) return;

    const updatePosition = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      setPosition(clampViewportMenuPosition(menu.x, menu.y, rect?.width ?? 0, rect?.height ?? 0));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [menu?.x, menu?.y, menuRef]);

  return position;
}

function clampViewportMenuPosition(x: number, y: number, width: number, height: number): ViewportMenuPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxHeight = Math.max(96, viewportHeight - VIEWPORT_MENU_MARGIN * 2);
  const effectiveWidth = width > 0 ? Math.min(width, viewportWidth - VIEWPORT_MENU_MARGIN * 2) : 0;
  const effectiveHeight = height > 0 ? Math.min(height, maxHeight) : 0;
  const maxLeft = effectiveWidth > 0
    ? Math.max(VIEWPORT_MENU_MARGIN, viewportWidth - effectiveWidth - VIEWPORT_MENU_MARGIN)
    : viewportWidth - VIEWPORT_MENU_MARGIN;
  const maxTop = effectiveHeight > 0
    ? Math.max(VIEWPORT_MENU_MARGIN, viewportHeight - effectiveHeight - VIEWPORT_MENU_MARGIN)
    : viewportHeight - VIEWPORT_MENU_MARGIN;

  return {
    left: clampNumber(x, VIEWPORT_MENU_MARGIN, maxLeft),
    top: clampNumber(y, VIEWPORT_MENU_MARGIN, maxTop),
    maxHeight,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function TransferSortMenu(props: {
  menu: TransferSortMenuState;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  onClose: () => void;
  onSort: (key: TransferSortableKey) => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const position = useViewportMenuPosition(props.menu, menuRef);
  if (!props.menu) return null;
  const run = (key: TransferSortableKey) => {
    props.onSort(key);
  };
  return createPortal(
    <div
      ref={menuRef}
      data-transfer-sort-menu
      className={transferStyles.sortMenu}
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
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
  batchPaused: boolean;
  selectedCount: number;
  hasTransfers: boolean;
  historyWorking: boolean;
  queueWorking: boolean;
  onClose: () => void;
  onPauseResume: (transfer: TransferRecord) => Promise<void>;
  onPauseResumeBatch: (transfer: TransferRecord) => Promise<void>;
  onCancelBatch: (transfer: TransferRecord) => Promise<void>;
  onResolveConflict: (transfer: TransferRecord, policy: "replace" | "skip" | "keep_both", applyToBatch: boolean) => Promise<void>;
  onCancel: (transfer: TransferRecord) => Promise<void>;
  onRetry: (transfer: TransferRecord) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDeleteRow: (transferId: number) => void;
  onDeleteSelected: () => void;
  onDeleteAll: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const position = useViewportMenuPosition(props.menu, menuRef);
  if (!props.menu) return null;
  const run = (action: () => void) => {
    props.onClose();
    action();
  };
  const canCancel = Boolean(props.row?.operationId && props.row.cancelable && !props.queueWorking);
  const canRetry = Boolean(props.row?.retryable && props.row.status === "failed" && !props.queueWorking);
  const canPauseResume = Boolean(props.row && canPauseResumeTransfer(props.row) && !props.queueWorking);
  const canResolve = Boolean(props.row?.operationId && props.row.status === "waiting_for_resolution" && !props.queueWorking);
  const hasOperation = Boolean(props.row?.operationId);
  const hasBatch = Boolean(props.row?.batchId);
  return createPortal(
    <div
      ref={menuRef}
      data-transfer-action-menu
      className={transferStyles.actionMenu}
      style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.row ? (
        <>
          {hasOperation ? (
            <>
              <button
                className={transferStyles.actionMenuItem}
                type="button"
                role="menuitem"
                disabled={!canPauseResume}
                onClick={() => props.row && run(() => void props.onPauseResume(props.row!))}
              >
                {props.row.paused ? <Play size={14} /> : <Pause size={14} />}
                {props.row.paused ? "Resume" : "Pause"}
              </button>
              {canResolve ? (
                <>
                  <div className={transferStyles.actionMenuSeparator} />
                  {props.row?.supportsReplace ? (
                    <button
                      className={transferStyles.actionMenuItem}
                      type="button"
                      role="menuitem"
                      onClick={() => props.row && run(() => void props.onResolveConflict(props.row!, "replace", false))}
                    >
                      Replace
                    </button>
                  ) : null}
                  <button
                    className={transferStyles.actionMenuItem}
                    type="button"
                    role="menuitem"
                    onClick={() => props.row && run(() => void props.onResolveConflict(props.row!, "skip", false))}
                  >
                    Skip
                  </button>
                  {props.row?.supportsKeepBoth ? (
                    <button
                      className={transferStyles.actionMenuItem}
                      type="button"
                      role="menuitem"
                      onClick={() => props.row && run(() => void props.onResolveConflict(props.row!, "keep_both", false))}
                    >
                      Keep Both
                    </button>
                  ) : null}
                  {hasBatch ? (
                    <>
                      <div className={transferStyles.actionMenuSeparator} />
                      {props.row?.supportsReplace ? (
                        <button
                          className={transferStyles.actionMenuItem}
                          type="button"
                          role="menuitem"
                          onClick={() => props.row && run(() => void props.onResolveConflict(props.row!, "replace", true))}
                        >
                          Replace Batch
                        </button>
                      ) : null}
                      <button
                        className={transferStyles.actionMenuItem}
                        type="button"
                        role="menuitem"
                        onClick={() => props.row && run(() => void props.onResolveConflict(props.row!, "skip", true))}
                      >
                        Skip Batch
                      </button>
                      {props.row?.supportsKeepBoth ? (
                        <button
                          className={transferStyles.actionMenuItem}
                          type="button"
                          role="menuitem"
                          onClick={() => props.row && run(() => void props.onResolveConflict(props.row!, "keep_both", true))}
                        >
                          Keep Both Batch
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
              <button
                className={transferStyles.actionMenuItem}
                type="button"
                role="menuitem"
                disabled={!canCancel}
                onClick={() => props.row && run(() => void props.onCancel(props.row!))}
              >
                <XCircle size={14} />
                Cancel
              </button>
              <button
                className={transferStyles.actionMenuItem}
                type="button"
                role="menuitem"
                disabled={!canRetry}
                onClick={() => props.row && run(() => void props.onRetry(props.row!))}
              >
                <RotateCcw size={14} />
                Retry
              </button>
              {hasBatch ? (
                <>
                  <div className={transferStyles.actionMenuSeparator} />
                  <button
                    className={transferStyles.actionMenuItem}
                    type="button"
                    role="menuitem"
                    disabled={props.queueWorking}
                    onClick={() => props.row && run(() => void props.onPauseResumeBatch(props.row!))}
                  >
                    {props.batchPaused ? <Play size={14} /> : <Pause size={14} />}
                    {props.batchPaused ? "Resume Batch" : "Pause Batch"}
                  </button>
                  <button
                    className={transferStyles.actionMenuItem}
                    type="button"
                    role="menuitem"
                    disabled={props.queueWorking}
                    onClick={() => props.row && run(() => void props.onCancelBatch(props.row!))}
                  >
                    <XCircle size={14} />
                    Cancel Batch
                  </button>
                </>
              ) : null}
              <div className={transferStyles.actionMenuSeparator} />
            </>
          ) : null}
          {!hasOperation && canRetry ? (
            <>
              <button
                className={transferStyles.actionMenuItem}
                type="button"
                role="menuitem"
                disabled={!canRetry}
                onClick={() => props.row && run(() => void props.onRetry(props.row!))}
              >
                <RotateCcw size={14} />
                Retry
              </button>
              <div className={transferStyles.actionMenuSeparator} />
            </>
          ) : null}
          {!hasOperation && props.row.undoable && props.row.undoTokenId ? (
            <>
              <button
                className={transferStyles.actionMenuItem}
                type="button"
                role="menuitem"
                disabled={props.queueWorking}
                onClick={() => props.row && run(() => props.onUndo(props.row!.undoTokenId))}
              >
                <RefreshCcw size={14} />
                Undo
              </button>
              <div className={transferStyles.actionMenuSeparator} />
            </>
          ) : null}
          <button
            className={`${transferStyles.actionMenuItem} ${transferStyles.actionMenuDanger}`}
            type="button"
            role="menuitem"
            disabled={props.historyWorking}
            onClick={() => run(() => props.onDeleteRow(props.row!.id))}
          >
            <Trash2 size={14} />
            Delete row
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
        Clear all rows
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
  treeDepth: number;
  hasChildren: boolean;
  expanded: boolean;
  columnOrder: TransferTableColumn[];
  operation?: OperationDescriptor;
  selected: boolean;
  focused: boolean;
  actionsVisible: boolean;
  queueWorking: boolean;
  historyWorking: boolean;
  onSelect: (row: TransferRecord, event: ReactMouseEvent) => void;
  onPauseResume: (transfer: TransferRecord) => Promise<void>;
  onResolveConflict: (transfer: TransferRecord, policy: "replace" | "skip" | "keep_both", applyToBatch: boolean) => Promise<void>;
  onCancel: (transfer: TransferRecord) => Promise<void>;
  onRetry: (transfer: TransferRecord) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDelete: (transferId: number) => void;
  onToggleTree: (transferId: number) => void;
  onOpenMenu: (event: ReactMouseEvent, row: TransferRecord) => void;
  onContextMenu: (event: ReactMouseEvent, row: TransferRecord) => void;
}) {
  return (
    <tr
      className={[
        transferStyles.tableRow,
        props.selected ? transferStyles.tableRowSelected : "",
        props.focused ? transferStyles.tableRowFocused : "",
      ].filter(Boolean).join(" ")}
      aria-selected={props.selected}
      onClick={(event) => props.onSelect(props.row, event)}
      onContextMenu={(event) => props.onContextMenu(event, props.row)}
    >
      {props.columnOrder.map((column) => (
        <TransferTableCell
          key={column}
          column={column}
          row={props.row}
          treeDepth={props.treeDepth}
          hasChildren={props.hasChildren}
          expanded={props.expanded}
          operation={props.operation}
          actionsVisible={props.actionsVisible}
          queueWorking={props.queueWorking}
          historyWorking={props.historyWorking}
          onPauseResume={props.onPauseResume}
          onResolveConflict={props.onResolveConflict}
          onCancel={props.onCancel}
          onRetry={props.onRetry}
          onUndo={props.onUndo}
          onDelete={props.onDelete}
          onToggleTree={props.onToggleTree}
          onOpenMenu={props.onOpenMenu}
        />
      ))}
    </tr>
  );
});

const TransferTableCell = memo(function TransferTableCell(props: {
  column: TransferTableColumn;
  row: TransferRecord;
  treeDepth: number;
  hasChildren: boolean;
  expanded: boolean;
  operation?: OperationDescriptor;
  actionsVisible: boolean;
  queueWorking: boolean;
  historyWorking: boolean;
  onPauseResume: (transfer: TransferRecord) => Promise<void>;
  onResolveConflict: (transfer: TransferRecord, policy: "replace" | "skip" | "keep_both", applyToBatch: boolean) => Promise<void>;
  onCancel: (transfer: TransferRecord) => Promise<void>;
  onRetry: (transfer: TransferRecord) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDelete: (transferId: number) => void;
  onToggleTree: (transferId: number) => void;
  onOpenMenu: (event: ReactMouseEvent, row: TransferRecord) => void;
}) {
  switch (props.column) {
    case "transfer":
      return (
        <td className={transferStyles.tableCell}>
          <div className={transferStyles.nameCellContent} style={{ paddingLeft: Math.min(props.treeDepth, 6) * 16 }}>
            {props.hasChildren ? (
              <button
                className={transferStyles.treeToggle}
                type="button"
                aria-label={props.expanded ? "Collapse transfer" : "Expand transfer"}
                title={props.expanded ? "Collapse transfer" : "Expand transfer"}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleTree(props.row.id);
                }}
              >
                {props.expanded ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
              </button>
            ) : (
              <span className={transferStyles.treeSpacer} aria-hidden="true" />
            )}
            <span className={transferStyles.nameText}>
              <strong className={transferStyles.tablePrimary}>{primaryTransferLabel(props.row)}</strong>
              <span className={transferStyles.tableSecondary}>J-{props.row.jobId} · {secondaryTransferLabel(props.row)}</span>
            </span>
          </div>
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
          <div className={`${transferStyles.rowActions} ${props.actionsVisible ? transferStyles.rowActionsVisible : ""}`}>
            <div className={transferStyles.rowActionGroup} role="group" aria-label="Transfer actions">
              {props.row.operationId ? (
                <>
                  <button
                    className={transferStyles.rowActionIconButton}
                    type="button"
                    aria-label={props.row.paused ? "Resume transfer" : "Pause transfer"}
                    title={props.row.paused ? "Resume transfer" : "Pause transfer"}
                    disabled={!canPauseResumeTransfer(props.row) || props.queueWorking}
                    onClick={() => void props.onPauseResume(props.row)}
                  >
                    {props.row.paused ? <Play aria-hidden="true" size={14} /> : <Pause aria-hidden="true" size={14} />}
                  </button>
                  <button
                    className={transferStyles.rowActionIconButton}
                    type="button"
                    aria-label="Cancel transfer"
                    title="Cancel transfer"
                    disabled={!props.row.cancelable || props.queueWorking}
                    onClick={() => void props.onCancel(props.row)}
                  >
                    <XCircle aria-hidden="true" size={14} />
                  </button>
                  <button
                    className={transferStyles.rowActionIconButton}
                    type="button"
                    aria-label="Retry transfer"
                    title="Retry transfer"
                    disabled={!props.row.retryable || props.row.status !== "failed" || props.queueWorking}
                    onClick={() => void props.onRetry(props.row)}
                  >
                    <RotateCcw aria-hidden="true" size={14} />
                  </button>
                </>
              ) : null}
              {!props.row.operationId && props.row.retryable && props.row.status === "failed" ? (
                <button
                  className={transferStyles.rowActionIconButton}
                  type="button"
                  aria-label="Retry transfer"
                  title="Retry transfer"
                  disabled={props.queueWorking}
                  onClick={() => void props.onRetry(props.row)}
                >
                  <RotateCcw aria-hidden="true" size={14} />
                </button>
              ) : null}
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
              <button
                className={transferStyles.rowActionIconButton}
                type="button"
                aria-label="More transfer actions"
                title="More transfer actions"
                onClick={(event) => props.onOpenMenu(event, props.row)}
              >
                <MoreVertical aria-hidden="true" size={14} />
              </button>
            </div>
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
  rows: TransferRecord[];
  operation?: OperationDescriptor;
  working: boolean;
  historyWorking: boolean;
  onCancel: (transfer: TransferRecord) => Promise<void>;
  onRetry: (transfer: TransferRecord) => Promise<void>;
  onPauseResume: (transfer: TransferRecord) => Promise<void>;
  onPauseResumeBatch: (transfer: TransferRecord) => Promise<void>;
  onCancelBatch: (transfer: TransferRecord) => Promise<void>;
  onResolveConflict: (transfer: TransferRecord, policy: "replace" | "skip" | "keep_both", applyToBatch: boolean) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
  onDelete: (transferId: number) => void;
}) {
  const row = props.transfer;
  const progress = useMemo(
    () => row ? aggregateTransferProgress(row, props.rows) : null,
    [props.rows, row],
  );
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
      <TransferProgressRow row={row} progress={progress} />
      <DetailRow label="Queued" value={timestampLabel(row.queuedAtMs)} />
      <DetailRow label="Started" value={timestampLabel(row.startedAtMs)} />
      <DetailRow label="Completed" value={timestampLabel(row.completedAtMs)} />
      <DetailRow label="Job ID" value={`J-${row.jobId}`} />
      {row.detailMessage ? <DetailRow label="Detail" value={row.detailMessage} /> : null}
      {row.errorMessage ? <DetailRow label="Error" value={row.errorMessage} danger /> : null}
      <div className={transferStyles.detailActions}>
        {row.operationId && canPauseResumeTransfer(row) ? (
          <button
            className={transferStyles.smallButton}
            type="button"
            disabled={props.working}
            onClick={() => void props.onPauseResume(row)}
          >
            {row.paused ? "Resume" : "Pause"}
          </button>
        ) : null}
        {row.operationId && row.status === "waiting_for_resolution" ? (
          <>
            {row.supportsReplace ? (
              <button
                className={transferStyles.smallButton}
                type="button"
                disabled={props.working}
                onClick={() => void props.onResolveConflict(row, "replace", false)}
              >
                Replace
              </button>
            ) : null}
            <button
              className={transferStyles.smallButton}
              type="button"
              disabled={props.working}
              onClick={() => void props.onResolveConflict(row, "skip", false)}
            >
              Skip
            </button>
            {row.supportsKeepBoth ? (
              <button
                className={transferStyles.smallButton}
                type="button"
                disabled={props.working}
                onClick={() => void props.onResolveConflict(row, "keep_both", false)}
              >
                Keep Both
              </button>
            ) : null}
          </>
        ) : null}
        {row.operationId && row.cancelable ? (
          <button
            className={transferStyles.smallButton}
            type="button"
            disabled={props.working}
            onClick={() => void props.onCancel(row)}
          >
            Cancel
          </button>
        ) : null}
        {row.retryable && row.status === "failed" ? (
          <button
            className={transferStyles.smallButton}
            type="button"
            disabled={props.working}
            onClick={() => void props.onRetry(row)}
          >
            Retry
          </button>
        ) : null}
        {row.batchId ? (
          <>
            <button
              className={transferStyles.smallButton}
              type="button"
              disabled={props.working}
              onClick={() => void props.onPauseResumeBatch(row)}
            >
              Pause/Resume Batch
            </button>
            <button
              className={transferStyles.smallButton}
              type="button"
              disabled={props.working}
              onClick={() => void props.onCancelBatch(row)}
            >
              Cancel Batch
            </button>
          </>
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

function TransferProgressRow(props: { row: TransferRecord; progress: TransferProgressSnapshot | null }) {
  const { row } = props;
  const progress = props.progress;
  if (isBinaryProgressTransfer(row)) {
    const complete = row.status === "completed";
    const percent = complete ? 100 : 0;
    const primary = complete ? "Complete" : binaryProgressStatus(row.status);
    const secondary = complete ? "Operation completed" : "Waiting for completion";

    return (
      <div className={transferStyles.detailRow}>
        <span className={transferStyles.detailLabel}>Progress</span>
        <div
          className={transferStyles.progressTrack}
          role="progressbar"
          aria-label="Operation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={complete ? "Complete" : `${primary}, not complete`}
        >
          <div className={transferStyles.progressFill} style={{ width: `${percent}%` }} />
        </div>
        <div className={transferStyles.progressMeta}>
          <strong className={transferStyles.progressMetaStrong}>{primary}</strong>
          <span>{secondary}</span>
        </div>
      </div>
    );
  }
  const transferred = Math.max(0, progress?.transferredBytes ?? row.transferredBytes);
  const total = Math.max(0, progress?.totalBytes ?? row.totalBytes);
  const hasTotal = total > 0;
  const percent = hasTotal ? Math.min(100, Math.max(0, Math.round((transferred / total) * 100))) : 0;
  const width = hasTotal ? `${percent}%` : undefined;
  const ariaValue = hasTotal ? percent : undefined;
  const primary = hasTotal ? `${percent}%` : "Waiting for total";
  const speed = Math.max(0, progress?.bytesPerSecond ?? row.bytesPerSecond ?? 0);
  const secondary = hasTotal
    ? `${formatBytes(transferred)} / ${formatBytes(total)}`
    : `${formatBytes(transferred)} transferred`;
  const tertiary = [
    progress?.aggregated ? "tree total" : "",
    speed > 0 ? `${formatBytes(speed)}/s` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className={transferStyles.detailRow}>
      <span className={transferStyles.detailLabel}>Progress</span>
      <div
        className={transferStyles.progressTrack}
        role="progressbar"
        aria-label="Transfer progress"
        aria-valuemin={0}
        aria-valuemax={hasTotal ? 100 : undefined}
        aria-valuenow={ariaValue}
        aria-valuetext={hasTotal ? `${percent}% complete` : secondary}
      >
        <div
          className={`${transferStyles.progressFill} ${hasTotal ? "" : transferStyles.progressFillUnknown}`}
          style={hasTotal ? { width } : undefined}
        />
      </div>
      <div className={transferStyles.progressMeta}>
        <strong className={transferStyles.progressMetaStrong}>{primary}</strong>
        <span>{tertiary ? `${secondary} · ${tertiary}` : secondary}</span>
      </div>
    </div>
  );
}

function isBinaryProgressTransfer(row: TransferRecord): boolean {
  return row.transferType === "create"
    || row.transferType === "archive"
    || row.transferType === "rename"
    || row.transferType === "delete";
}

function binaryProgressStatus(status: TransferRecord["status"]): string {
  if (status === "queued" || status === "pending") return "Queued";
  if (status === "in_progress") return "In progress";
  if (status === "waiting_for_resolution") return "Waiting for resolution";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  if (status === "skipped") return "Skipped";
  if (status === "interrupted") return "Interrupted";
  return prettyLabel(status);
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

function buildTransferTreeRows(
  rows: TransferRecord[],
  expandedIds: Set<number>,
): TransferTreeRow[] {
  const order = new Map<number, number>();
  rows.forEach((row, index) => order.set(row.id, index));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const childRows = new Map<number, TransferRecord[]>();
  for (const row of rows) {
    if (!row.parentTransferId || !rowsById.has(row.parentTransferId)) continue;
    const children = childRows.get(row.parentTransferId) ?? [];
    children.push(row);
    childRows.set(row.parentTransferId, children);
  }
  for (const children of childRows.values()) {
    children.sort((left, right) => {
      const nameComparison = primaryTransferLabel(left).localeCompare(primaryTransferLabel(right));
      return nameComparison || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
    });
  }
  const result: TransferTreeRow[] = [];
  const pushRow = (row: TransferRecord, depth: number, visited: Set<number>) => {
    const children = childRows.get(row.id) ?? [];
    const expanded = expandedIds.has(row.id);
    result.push({
      row,
      depth,
      hasChildren: children.length > 0,
      expanded,
    });
    if (!expanded || visited.has(row.id)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(row.id);
    for (const child of children) {
      pushRow(child, depth + 1, nextVisited);
    }
  };
  for (const row of rows) {
    if (row.parentTransferId && rowsById.has(row.parentTransferId)) continue;
    pushRow(row, 0, new Set());
  }
  return result;
}

function includeTransferAncestors(filteredRows: TransferRecord[], allRows: TransferRecord[]): TransferRecord[] {
  if (filteredRows.length === 0) return filteredRows;
  const rowsById = new Map(allRows.map((row) => [row.id, row]));
  const included = new Set(filteredRows.map((row) => row.id));
  const result = [...filteredRows];
  for (const row of filteredRows) {
    let parentId = row.parentTransferId;
    const visited = new Set<number>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = rowsById.get(parentId);
      if (!parent) break;
      if (!included.has(parent.id)) {
        included.add(parent.id);
        result.push(parent);
      }
      parentId = parent.parentTransferId;
    }
  }
  const order = new Map(allRows.map((row, index) => [row.id, index]));
  return result.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}

function aggregateTransferProgress(row: TransferRecord, rows: TransferRecord[]): TransferProgressSnapshot {
  const childrenByParent = new Map<number, TransferRecord[]>();
  for (const candidate of rows) {
    if (!candidate.parentTransferId) continue;
    const children = childrenByParent.get(candidate.parentTransferId) ?? [];
    children.push(candidate);
    childrenByParent.set(candidate.parentTransferId, children);
  }
  const descendants: TransferRecord[] = [];
  const pending = [...(childrenByParent.get(row.id) ?? [])];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    descendants.push(current);
    pending.push(...(childrenByParent.get(current.id) ?? []));
  }
  if (descendants.length === 0) {
    const transferredBytes = Math.max(0, row.transferredBytes);
    const rowTotal = Math.max(0, row.totalBytes);
    return {
      transferredBytes,
      totalBytes: rowTotal || (isTerminalTransfer(row) ? transferredBytes : 0),
      bytesPerSecond: Math.max(0, row.bytesPerSecond || 0),
      aggregated: false,
    };
  }
  if (!isTerminalTransfer(row) && row.totalBytes > 0) {
    const transferredBytes = Math.max(0, row.transferredBytes);
    return {
      transferredBytes,
      totalBytes: Math.max(0, row.totalBytes),
      bytesPerSecond: Math.max(0, row.bytesPerSecond || 0),
      aggregated: false,
    };
  }
  let transferredBytes = 0;
  let totalBytes = 0;
  let bytesPerSecond = 0;
  for (const descendant of descendants) {
    const transferred = Math.max(0, descendant.transferredBytes);
    const total = Math.max(0, descendant.totalBytes);
    transferredBytes += transferred;
    totalBytes += total || (isTerminalTransfer(descendant) ? transferred : 0);
    bytesPerSecond += Math.max(0, descendant.bytesPerSecond || 0);
  }
  return {
    transferredBytes,
    totalBytes,
    bytesPerSecond,
    aggregated: true,
  };
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

function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  if (value < 1024) return `${value.toLocaleString()} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
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

function canPauseResumeTransfer(transfer: TransferRecord): boolean {
  return Boolean(transfer.operationId)
    && (
      transfer.paused
      || transfer.status === "queued"
      || transfer.status === "in_progress"
      || transfer.status === "waiting_for_resolution"
    );
}

function isLiveTransfer(transfer: TransferRecord): boolean {
  return transfer.status === "queued"
    || transfer.status === "pending"
    || transfer.status === "in_progress"
    || transfer.status === "waiting_for_resolution";
}

function isTerminalTransfer(transfer: TransferRecord): boolean {
  return !isLiveTransfer(transfer);
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
