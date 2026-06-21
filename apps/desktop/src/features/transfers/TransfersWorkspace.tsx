import { Filter, RefreshCcw, RotateCcw, Search, Trash2, XCircle } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { OperationDescriptor, TransferRecord, TransferType } from "../../api/types";
import { prettyLabel } from "../../shared/format";
import { MultiPanelWorkspace } from "../../shared/multipanel/MultiPanelWorkspace";
import type { MultiPanelClosedPane, MultiPanelTab } from "../../shared/multipanel/types";
import { createMultiPanelStore, type MultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { useProvidersStore } from "../providers/useProvidersStore";
import { relativeTime, remoteSummary, transferProgress } from "./transferUtils";
import { useOperationQueueStore } from "./useOperationQueueStore";
import {
  activeTransferFilterCount,
  createTransferWorkspaceState,
  TRANSFERS_PAGE_SIZE,
  transferStatusMatchesFilter,
  transferTypes,
  useTransfersStore,
} from "./useTransfersStore";

const useTransfersMultiPanelStore = createMultiPanelStore({ idPrefix: "transfers", defaultTitle: "Transfers" });

type TransferTableColumn = "transfer" | "operation" | "status" | "progress" | "time" | "remote" | "actions";

type TransferColumnWidths = Record<TransferTableColumn, number>;

const transferTableColumns: TransferTableColumn[] = ["transfer", "operation", "status", "progress", "time", "remote", "actions"];
const transferColumnLabels: Record<TransferTableColumn, string> = {
  transfer: "Transfer",
  operation: "Operation",
  status: "Status",
  progress: "Progress",
  time: "Time",
  remote: "Remote",
  actions: "Actions",
};
const transferSortByColumn: Partial<Record<TransferTableColumn, "time" | "name" | "operation" | "status">> = {
  transfer: "name",
  operation: "operation",
  status: "status",
  time: "time",
};
const transferDefaultColumnWidths: TransferColumnWidths = {
  transfer: 280,
  operation: 135,
  status: 135,
  progress: 130,
  time: 130,
  remote: 180,
  actions: 240,
};
const transferMinimumColumnWidths: TransferColumnWidths = {
  transfer: 190,
  operation: 110,
  status: 110,
  progress: 110,
  time: 105,
  remote: 140,
  actions: 190,
};
const TRANSFER_CHECKBOX_COLUMN_WIDTH = 46;
const TRANSFERS_MULTIPANEL_STORAGE_KEY = "misty.transfers.multipanel.v1";
const TRANSFER_COLUMN_WIDTHS_STORAGE_KEY = "misty.transfers.table.columnWidths";
const TRANSFER_COLUMN_ORDER_STORAGE_KEY = "misty.transfers.table.columnOrder";
const TRANSFER_ROW_HEIGHT = 64;
const TRANSFER_OVERSCAN_ROWS = 8;

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
      className="transfers-workspace"
      store={useTransfersMultiPanelStore}
      renderPane={(paneId) => <TransferWorkspacePane workspaceId={paneId} />}
    />
  );
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
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const pageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const transferSummary = useMemo(() => summarizeTransfers(rows), [rows]);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollFrameRef = useRef<number | null>(null);
  const tableViewportHeightRef = useRef(0);
  const tableScrollTopRef = useRef(0);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const [columnWidths, setColumnWidths] = useState<TransferColumnWidths>(loadTransferColumnWidths);
  const [columnOrder, setColumnOrder] = useState<TransferTableColumn[]>(loadTransferColumnOrder);
  const [draggedColumn, setDraggedColumn] = useState<TransferTableColumn | null>(null);
  const tableWidth = TRANSFER_CHECKBOX_COLUMN_WIDTH + columnOrder.reduce((sum, column) => sum + columnWidths[column], 0);
  const rowCount = pageRows.length;
  const visibleCapacity = Math.max(1, Math.ceil(tableViewportHeight / TRANSFER_ROW_HEIGHT));
  const startIndex = Math.max(0, Math.floor(tableScrollTop / TRANSFER_ROW_HEIGHT) - TRANSFER_OVERSCAN_ROWS);
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
    void undoOperation(undoTokenId).then(() => load(undefined, { silent: true }));
  }, [load, undoOperation]);
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

  return (
    <div className="transfer-pane-workspace">
      <div className="panel-header transfers-header">
        <div>
          <h2>File Transfers</h2>
          <p>{transfers ? `${filteredRows.length} visible · ${transfers.totalCount} history rows · ${transfers.dbPath}` : "Loading transfer history"}</p>
        </div>
        <div className="transfer-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input value={search} placeholder="Search transfers" onChange={(event) => setSearch(props.workspaceId, event.target.value)} />
          </label>
          <span className="active-filter-pill">
            <Filter size={15} />
            {activeFilterCount} filters
          </span>
          <button onClick={() => void load()} disabled={working}>
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button onClick={() => void deleteSelected(props.workspaceId)} disabled={working || selectedIds.size === 0}>
            <Trash2 size={16} />
            Delete Selected
          </button>
          <button className="danger" onClick={() => void deleteAll()} disabled={working || !transfers || transfers.totalCount === 0}>
            <Trash2 size={16} />
            Delete All
          </button>
        </div>
      </div>

      <TransferSummaryCards summary={transferSummary} visibleCount={filteredRows.length} />

      <div className="transfers-panels-scroll">
        <div className="transfers-three-panel">
          <aside className="transfer-filter-panel">
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

          <main className="transfer-list-panel">
          <OperationQueueStrip />
          <div ref={tableScrollRef} className="transfer-table-wrap" onScroll={handleTableScroll}>
            <table className="transfer-table" style={{ width: tableWidth, minWidth: "100%" }}>
              <colgroup>
                <col style={{ width: TRANSFER_CHECKBOX_COLUMN_WIDTH }} />
                {columnOrder.map((column) => <col key={column} style={{ width: columnWidths[column] }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input
                      type="checkbox"
                      aria-label={pageSelected ? "Deselect visible transfers" : "Select visible transfers"}
                      checked={pageSelected}
                      disabled={pageIds.length === 0}
                      onChange={(event) => setTransfersSelected(props.workspaceId, pageIds, event.target.checked)}
                    />
                  </th>
                  {columnOrder.map((column) => (
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
                    <td colSpan={columnOrder.length + 1} style={{ height: topSpacerHeight, padding: 0 }} />
                  </tr>
                ) : null}
                {visibleRows.map((row) => {
                  const operation = queueOperationsByTransfer.get(row.id);
                  return (
                    <TransferTableRow
                      key={row.id}
                      row={row}
                      columnOrder={columnOrder}
                      operation={operation}
                      selected={selectedIds.has(row.id)}
                      focused={focusedTransfer?.id === row.id}
                      queueWorking={queueWorking}
                      onSelect={(id, checked) => toggleTransfer(props.workspaceId, id, checked)}
                      onFocus={(id) => setFocusedTransfer(props.workspaceId, id)}
                      onCancel={cancelOperation}
                      onRetry={retryOperation}
                      onUndo={handleUndo}
                    />
                  );
                })}
                {bottomSpacerHeight > 0 ? (
                  <tr aria-hidden="true">
                    <td colSpan={columnOrder.length + 1} style={{ height: bottomSpacerHeight, padding: 0 }} />
                  </tr>
                ) : null}
              </tbody>
            </table>
            {transfers && filteredRows.length === 0 ? <div className="empty">No transfer history matches these filters.</div> : null}
          </div>
          <div className="transfer-pagination">
            <span>
              {filteredRows.length === 0
                ? "No transfers"
                : `Page ${activePageIndex + 1} of ${pageCount} · ${filteredRows.length} transfers`}
            </span>
            <div>
              <button
                type="button"
                disabled={activePageIndex === 0 || filteredRows.length === 0}
                onClick={() => setPageIndex(props.workspaceId, activePageIndex - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={activePageIndex + 1 >= pageCount || filteredRows.length === 0}
                onClick={() => setPageIndex(props.workspaceId, activePageIndex + 1)}
              >
                Next
              </button>
            </div>
          </div>
          </main>

          <aside className="transfer-detail-panel">
            <TransferDetail
              transfer={focusedTransfer}
              operation={focusedTransfer ? queueOperationsByTransfer.get(focusedTransfer.id) : undefined}
              working={queueWorking}
              onCancel={cancelOperation}
              onRetry={retryOperation}
              onUndo={handleUndo}
            />
          </aside>
        </div>
      </div>
    </div>
  );
});

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
    <div className="transfer-summary" aria-label="Transfer summary">
      {cards.map((card) => (
        <div className="transfer-summary-card" key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <em>{card.detail}</em>
        </div>
      ))}
    </div>
  );
});

const TransferTableHeader = memo(function TransferTableHeader(props: {
  column: TransferTableColumn;
  label: string;
  sortKey: string;
  sortDirection: "asc" | "desc";
  dragging: boolean;
  onSort: (key: "time" | "name" | "operation" | "status") => void;
  onResizeStart: (column: TransferTableColumn, event: ReactPointerEvent) => void;
  onDragStart: (column: TransferTableColumn) => void;
  onDragEnd: () => void;
  onColumnDrop: (source: TransferTableColumn, target: TransferTableColumn) => void;
}) {
  const sort = transferSortByColumn[props.column];
  return (
    <th
      className={props.dragging ? "dragging" : undefined}
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
        <button type="button" onClick={() => props.onSort(sort)}>
          {props.label} {sortIndicator(props.sortKey, props.sortDirection, sort)}
        </button>
      ) : (
        <span>{props.label}</span>
      )}
      <span
        className="transfer-table-resize-handle"
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
  onSelect: (id: number, checked: boolean) => void;
  onFocus: (id: number | null) => void;
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
}) {
  return (
    <tr
      className={props.focused ? "focused" : undefined}
      onClick={() => props.onFocus(props.row.id)}
    >
      <td className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
        <input
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
          onCancel={props.onCancel}
          onRetry={props.onRetry}
          onUndo={props.onUndo}
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
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
}) {
  switch (props.column) {
    case "transfer":
      return (
        <td>
          <strong>{primaryTransferLabel(props.row)}</strong>
          <span>J-{props.row.jobId} · {secondaryTransferLabel(props.row)}</span>
        </td>
      );
    case "operation":
      return <td>{prettyLabel(props.row.transferType)}</td>;
    case "status":
      return (
        <td>
          <span className={`status-badge ${props.row.status}`}>{prettyLabel(props.row.status)}</span>
        </td>
      );
    case "progress":
      return <td>{transferProgress(props.row)}</td>;
    case "time":
      return <td>{relativeTime(transferTime(props.row))}</td>;
    case "remote":
      return <td>{remoteSummary(props.row)}</td>;
    case "actions":
      return (
        <td className="transfer-row-actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            disabled={!props.operation?.cancelable || props.queueWorking}
            onClick={() => props.operation && void props.onCancel(props.operation.operationId)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!props.operation?.retryable || props.operation.status !== "failed" || props.queueWorking}
            onClick={() => props.operation && void props.onRetry(props.operation.operationId)}
          >
            Retry
          </button>
          <button
            type="button"
            disabled={!props.row.undoable || !props.row.undoTokenId || props.queueWorking}
            onClick={() => props.onUndo(props.row.undoTokenId)}
          >
            Undo
          </button>
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
  sortKey: string;
  sortDirection: "asc" | "desc";
  activeFilterCount: number;
  onToggleProvider: (provider: string) => void;
  onToggleType: (type: TransferType) => void;
  onLocationScope: (scope: "all" | "local" | "remote") => void;
  onStatusFilter: (filter: "all" | "active" | "completed" | "failed") => void;
  onSort: (key: "time" | "name" | "operation" | "status", direction?: "asc" | "desc") => void;
  onClear: () => void;
}) {
  return (
    <div className="transfer-filter-content">
      <div className="transfer-filter-heading">
        <strong>Filters</strong>
        <button type="button" disabled={props.activeFilterCount === 0} onClick={props.onClear}>Clear</button>
      </div>
      <FilterSection title="Providers">
        {props.providerGroups.length === 0 ? <span className="sidebar-muted">No remote providers</span> : null}
        {props.providerGroups.map((group) => (
          <label key={group.key} className="transfer-filter-check">
            <input
              type="checkbox"
              checked={props.providerFilters.has(group.key)}
              onChange={() => props.onToggleProvider(group.key)}
            />
            <span>{group.label}</span>
            <em>{group.count}</em>
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Transfer Type">
        {transferTypes.map((type) => (
          <label key={type} className="transfer-filter-check">
            <input
              type="checkbox"
              checked={props.typeFilters.has(type)}
              onChange={() => props.onToggleType(type)}
            />
            <span>{prettyLabel(type)}</span>
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Location">
        {(["all", "local", "remote"] as const).map((scope) => (
          <label key={scope} className="transfer-filter-radio">
            <input
              type="radio"
              checked={props.locationScope === scope}
              onChange={() => props.onLocationScope(scope)}
            />
            {scope === "all" ? "All" : scope === "local" ? "Local only" : "Remote involved"}
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Status">
        {(["all", "active", "completed", "failed"] as const).map((filter) => (
          <label key={filter} className="transfer-filter-radio">
            <input
              type="radio"
              checked={props.statusFilter === filter}
              onChange={() => props.onStatusFilter(filter)}
            />
            {prettyLabel(filter)}
          </label>
        ))}
      </FilterSection>
      <FilterSection title="Sort">
        <select
          value={props.sortKey}
          onChange={(event) => props.onSort(event.target.value as "time" | "name" | "operation" | "status", props.sortDirection)}
        >
          <option value="time">Time</option>
          <option value="name">Name</option>
          <option value="operation">Operation</option>
          <option value="status">Status</option>
        </select>
        <div className="transfer-sort-direction">
          <button
            type="button"
            className={props.sortDirection === "asc" ? "selected" : undefined}
            onClick={() => props.onSort(props.sortKey as "time" | "name" | "operation" | "status", "asc")}
          >
            Asc
          </button>
          <button
            type="button"
            className={props.sortDirection === "desc" ? "selected" : undefined}
            onClick={() => props.onSort(props.sortKey as "time" | "name" | "operation" | "status", "desc")}
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
    <section className="transfer-filter-section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function TransferDetail(props: {
  transfer: TransferRecord | null;
  operation?: OperationDescriptor;
  working: boolean;
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  onUndo: (undoTokenId: number) => void;
}) {
  const row = props.transfer;
  if (!row) {
    return (
      <div className="transfer-detail-empty">
        <h3>Transfer Detail</h3>
        <p>Select a transfer to inspect endpoints, progress, and status.</p>
      </div>
    );
  }
  return (
    <div className="transfer-detail-content">
      <header>
        <h3>{primaryTransferLabel(row)}</h3>
        <span className={`status-badge ${row.status}`}>{prettyLabel(row.status)}</span>
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
      <div className="transfer-detail-actions">
        {props.operation?.cancelable ? (
          <button
            type="button"
            disabled={props.working}
            onClick={() => void props.onCancel(props.operation!.operationId)}
          >
            Cancel
          </button>
        ) : null}
        {props.operation?.retryable && props.operation.status === "failed" ? (
          <button
            type="button"
            disabled={props.working}
            onClick={() => void props.onRetry(props.operation!.operationId)}
          >
            Retry
          </button>
        ) : null}
        {row.undoable && row.undoTokenId ? (
          <button
            type="button"
            disabled={props.working}
            onClick={() => props.onUndo(row.undoTokenId)}
          >
            Undo
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={props.danger ? "transfer-detail-row danger" : "transfer-detail-row"}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
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
    sortKey: string;
    sortDirection: "asc" | "desc";
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

  const direction = filters.sortDirection === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => direction * compareTransfers(left, right, filters.sortKey));
}

function compareTransfers(left: TransferRecord, right: TransferRecord, key: string): number {
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

function sortIndicator(activeKey: string, direction: string, key: string): string {
  if (activeKey !== key) return "";
  return direction === "asc" ? "↑" : "↓";
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

function OperationQueueStrip() {
  const { snapshot, working, error, load, cancel, retry, resolveConflict, clearTerminal } = useOperationQueueStore(useShallow((state) => ({
    snapshot: state.snapshot,
    working: state.working,
    error: state.error,
    load: state.load,
    cancel: state.cancel,
    retry: state.retry,
    resolveConflict: state.resolveConflict,
    clearTerminal: state.clearTerminal,
  })));
  const operations = snapshot?.operations ?? [];
  const active = operations.filter((operation) => operation.status === "queued" || operation.status === "in_progress" || operation.status === "waiting_for_resolution");
  const terminal = operations.length - active.length;
  const conflict = snapshot?.conflictDialog;
  const conflictBatch = conflict?.open ? snapshot?.batches.find((batch) => batch.batchId === conflict.batchId) : null;
  const canApplyConflictToBatch = Boolean(conflictBatch && conflictBatch.operationIds.length > 1);
  const [applyConflictToBatch, setApplyConflictToBatch] = useState(conflict?.applyToBatch ?? true);

  useEffect(() => {
    if (conflict?.open) {
      setApplyConflictToBatch(conflict.applyToBatch);
    }
  }, [conflict?.operationId, conflict?.applyToBatch, conflict?.open]);

  return (
    <section className="operation-queue-strip">
      <div>
        <strong>Operation Queue</strong>
        <span>
          {snapshot ? `${active.length} active · ${terminal} finished · ${snapshot.maxConcurrent} max` : "Not loaded"}
        </span>
      </div>
      <div className="operation-queue-actions">
        {error ? <span className="error-text">{error}</span> : null}
        <button type="button" onClick={() => void load()} disabled={working}>
          <RefreshCcw size={14} />
          Refresh
        </button>
        <button type="button" onClick={() => void clearTerminal()} disabled={working || terminal === 0}>
          <Trash2 size={14} />
          Clear Finished
        </button>
      </div>
      {conflict?.open ? (
        <div className="operation-conflict-row">
          <div>
            <strong>{conflict.title || "Resolve conflict"}</strong>
            <span>{conflict.sourceLabel} → {conflict.targetLabel}</span>
          </div>
          <label className="operation-conflict-apply">
            <input
              type="checkbox"
              checked={canApplyConflictToBatch && applyConflictToBatch}
              disabled={working || !canApplyConflictToBatch}
              onChange={(event) => setApplyConflictToBatch(event.currentTarget.checked)}
            />
            <span>Apply to batch</span>
          </label>
          <button type="button" disabled={working} onClick={() => void cancel(conflict.operationId)}>
            Cancel
          </button>
          {conflict.supportsReplace ? (
            <button type="button" disabled={working} onClick={() => void resolveConflict(conflict.operationId, "replace", canApplyConflictToBatch && applyConflictToBatch)}>
              Replace
            </button>
          ) : null}
          <button type="button" disabled={working} onClick={() => void resolveConflict(conflict.operationId, "skip", canApplyConflictToBatch && applyConflictToBatch)}>
            Skip
          </button>
          {conflict.supportsKeepBoth ? (
            <button type="button" disabled={working} onClick={() => void resolveConflict(conflict.operationId, "keep_both", canApplyConflictToBatch && applyConflictToBatch)}>
              Keep Both
            </button>
          ) : null}
        </div>
      ) : null}
      {operations.length > 0 ? (
        <div className="operation-queue-list">
          {operations.slice(0, 5).map((operation) => (
            <div key={operation.operationId} className="operation-queue-row">
              <span>{operation.title || prettyLabel(operation.kind)}</span>
              <span className={`status-badge ${operation.status}`}>{prettyLabel(operation.status)}</span>
              <span>{operation.source.localPath || `${operation.source.remoteName}:${operation.source.remotePath}`}</span>
              <span>{operation.target.localPath || `${operation.target.remoteName}:${operation.target.remotePath}`}</span>
              <button type="button" disabled={!operation.cancelable || working} onClick={() => void cancel(operation.operationId)}>
                <XCircle size={14} />
                Cancel
              </button>
              <button type="button" disabled={!operation.retryable || operation.status !== "failed" || working} onClick={() => void retry(operation.operationId)}>
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
