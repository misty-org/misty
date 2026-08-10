import { useProvidersStore } from "@/features/providers";
import type { TransferRecord } from "@/services/misty/model/misty-api";
import { prettyLabel } from "@/shared/lib/format";
import { Input, Toolbar, ToolbarGroup } from "@/shared/ui";
import { Search } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { TransferSortMenu, TransferToolbarActions } from "./components/TransferMenus";
import { TransferPagination } from "./components/TransferPagination";
import { TransferDetail, TransferFilters } from "./components/TransferPanels";
import { TransferHistoryTable } from "./components/TransferTable";
import { TransfersBottomBar } from "./components/TransfersBottomBar";
import type {
  TransferColumnWidths,
  TransferTableColumn,
} from "./model/page-types/workspace/transferModel";
import {
  activeTransferFilterCount,
  createTransferWorkspaceState,
  TRANSFERS_PAGE_SIZE,
  useTransfersStore,
} from "./store";
import {
  buildTransferTreeRows,
  filterAndSortTransfers,
  filterTransferSearch,
  includeTransferAncestors,
  TRANSFER_OVERSCAN_ROWS,
  TRANSFER_ROW_HEIGHT,
  transferMinimumColumnWidths,
  transferProviderGroups,
} from "./transferModel";
import {
  loadTransferColumnOrder,
  loadTransferColumnWidths,
  loadTransferPanelVisibility,
  saveTransferColumnOrder,
  saveTransferColumnWidths,
  saveTransferPanelVisibility,
} from "./transferPersistence";
import { transferStyles } from "./transferStyles";
import { useTransferActions } from "./useTransferActions";

export const TransferWorkspacePane = memo(function TransferWorkspacePane(props: {
  workspaceId: string;
}) {
  const {
    transfers,
    workspaces,
    working,
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
  } = useTransfersStore(
    useShallow((state) => ({
      transfers: state.transfers,
      workspaces: state.workspaces,
      working: state.working,
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
    })),
  );
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
  const rows = useMemo(() => transfers?.rows ?? [], [transfers?.rows]);
  const {
    actionFeedback,
    handleCancelBatchTransfer,
    handleCancelTransfer,
    handleDeleteAll,
    handleDeleteSelected,
    handleDeleteTransfer,
    handlePauseResumeBatchTransfer,
    handlePauseResumeTransfer,
    handleResolveConflictTransfer,
    handleRetryTransfer,
    handleUndo,
    isBatchPaused,
    isTransferPaused,
    loadQueue,
    loadTransfers,
    queueWorking,
  } = useTransferActions({ workspaceId: props.workspaceId, rows });

  useEffect(() => {
    ensureWorkspace(props.workspaceId);
    void loadTransfers();
    void loadQueue();
  }, [ensureWorkspace, loadQueue, loadTransfers, props.workspaceId]);

  useEffect(() => {
    if (!providerSnapshot) void loadProviders(false);
  }, [loadProviders, providerSnapshot]);

  const providerLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const remote of providerSnapshot?.remotes ?? [])
      labels.set(remote.name, `${prettyLabel(remote.type)} · ${remote.name}`);
    return labels;
  }, [providerSnapshot?.remotes]);
  const providerGroups = useMemo(
    () => transferProviderGroups(rows, providerLabels),
    [providerLabels, rows],
  );
  const searchedRows = useMemo(() => filterTransferSearch(rows, search), [rows, search]);
  const filteredRows = useMemo(
    () =>
      filterAndSortTransfers(searchedRows, {
        providerFilters,
        typeFilters,
        locationScope,
        statusFilter,
        sortKey,
        sortDirection,
      }),
    [
      locationScope,
      providerFilters,
      searchedRows,
      sortDirection,
      sortKey,
      statusFilter,
      typeFilters,
    ],
  );
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
  const focusedTransfer =
    treeInputRows.find((row) => row.id === focusedTransferId) ?? treeInputRows[0] ?? null;
  const activeFilterCount = activeTransferFilterCount({
    providerFilters,
    typeFilters,
    locationScope,
    statusFilter,
  });

  const visibleTransferIds = useMemo(() => pageRows.map((entry) => entry.row.id), [pageRows]);
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
  const filtersVisible = panelVisibility.filters;
  const detailVisible = panelVisibility.detail;
  const visibleColumnOrder = useMemo(
    () => columnOrder.filter((column) => column !== "remote"),
    [columnOrder],
  );
  const tableWidth = visibleColumnOrder.reduce((sum, column) => sum + columnWidths[column], 0);
  const panelGridStyle = useMemo(
    () => ({
      gridTemplateColumns: [
        filtersVisible ? "224px" : "",
        "minmax(0, 1fr)",
        detailVisible ? "304px" : "",
      ]
        .filter(Boolean)
        .join(" "),
    }),
    [detailVisible, filtersVisible],
  );
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
      if (tableScrollFrameRef.current !== null)
        window.cancelAnimationFrame(tableScrollFrameRef.current);
    };
  }, [rowCount, updateTableViewport]);
  const handleTableScroll = useCallback(() => {
    if (tableScrollFrameRef.current !== null) return;
    tableScrollFrameRef.current = window.requestAnimationFrame(() => {
      tableScrollFrameRef.current = null;
      const element = tableScrollRef.current;
      if (!element || tableScrollTopRef.current === element.scrollTop) return;
      tableScrollTopRef.current = element.scrollTop;
      setTableScrollTop(element.scrollTop);
    });
  }, []);

  const handleSelectTransfer = useCallback(
    (row: TransferRecord, event: ReactMouseEvent) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey) event.preventDefault();
      selectTransfer(props.workspaceId, row.id, {
        toggle: event.metaKey || event.ctrlKey,
        range: event.shiftKey,
        visibleTransferIds,
      });
    },
    [props.workspaceId, selectTransfer, visibleTransferIds],
  );
  const handleFocusTransfer = useCallback(
    (row: TransferRecord) => setFocusedTransfer(props.workspaceId, row.id),
    [props.workspaceId, setFocusedTransfer],
  );
  const toggleTransferTree = useCallback((transferId: number) => {
    setExpandedTransferIds((current) => {
      const next = new Set(current);
      if (next.has(transferId)) next.delete(transferId);
      else next.add(transferId);
      return next;
    });
  }, []);
  const beginColumnResize = useCallback(
    (column: TransferTableColumn, event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidths[column];
      let pendingWidth = startWidth;
      let frame: number | null = null;
      const applyWidth = () => {
        frame = null;
        setColumnWidths((current) =>
          current[column] === pendingWidth ? current : { ...current, [column]: pendingWidth },
        );
      };
      const onPointerMove = (moveEvent: PointerEvent) => {
        pendingWidth = Math.max(
          transferMinimumColumnWidths[column],
          startWidth + moveEvent.clientX - startX,
        );
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
    },
    [columnWidths],
  );
  const reorderColumn = useCallback((source: TransferTableColumn, target: TransferTableColumn) => {
    if (source === target) return;
    setColumnOrder((current) => {
      const withoutSource = current.filter((column) => column !== source);
      const targetIndex = withoutSource.indexOf(target);
      if (targetIndex < 0) return current;
      const next = [
        ...withoutSource.slice(0, targetIndex),
        source,
        ...withoutSource.slice(targetIndex),
      ];
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

  const actionMenuProps = {
    batchPaused: false,
    selectedCount: selectedIds.size,
    hasTransfers: Boolean(transfers && transfers.totalCount > 0),
    historyWorking: working,
    queueWorking,
    onPauseResume: handlePauseResumeTransfer,
    onPauseResumeBatch: handlePauseResumeBatchTransfer,
    onCancelBatch: handleCancelBatchTransfer,
    onResolveConflict: handleResolveConflictTransfer,
    onCancel: handleCancelTransfer,
    onRetry: handleRetryTransfer,
    onUndo: handleUndo,
    onDeleteRow: handleDeleteTransfer,
    onDeleteSelected: handleDeleteSelected,
    onDeleteAll: handleDeleteAll,
  };

  return (
    <div className={transferStyles.pane}>
      <div className={transferStyles.panelsScroll}>
        <div className={transferStyles.threePanel} style={panelGridStyle}>
          {filtersVisible ? (
            <aside className={transferStyles.panel} aria-label="Transfer filters">
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

          <section
            className={`${transferStyles.listPanel} ${detailVisible ? "" : transferStyles.listPanelNoRight}`}
            aria-label="Transfer history"
            aria-busy={working}
          >
            <Toolbar label="Transfer history controls" className={transferStyles.toolbar}>
              {actionFeedback ? (
                <span
                  className={[
                    transferStyles.actionFeedback,
                    actionFeedback.tone === "busy" ? transferStyles.actionFeedbackBusy : "",
                    actionFeedback.tone === "success" ? transferStyles.actionFeedbackSuccess : "",
                    actionFeedback.tone === "error" ? transferStyles.actionFeedbackError : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  role="status"
                  aria-live="polite"
                >
                  {actionFeedback.text}
                </span>
              ) : null}
              <ToolbarGroup align="end">
                <label className={transferStyles.searchBox}>
                  <span className="sr-only">Search transfers</span>
                  <Search aria-hidden="true" className="size-4" />
                  <Input
                    value={search}
                    placeholder="Search transfers"
                    onChange={(event) => setSearch(props.workspaceId, event.target.value)}
                  />
                </label>
                <TransferSortMenu
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={(key) => setSort(props.workspaceId, key)}
                />
                <TransferToolbarActions {...actionMenuProps} row={null} />
              </ToolbarGroup>
            </Toolbar>
            <div
              ref={tableScrollRef}
              className={transferStyles.tableWrap}
              onScroll={handleTableScroll}
            >
              <TransferHistoryTable
                {...actionMenuProps}
                rows={visibleRows}
                columnOrder={visibleColumnOrder}
                columnWidths={columnWidths}
                tableWidth={tableWidth}
                topSpacerHeight={topSpacerHeight}
                bottomSpacerHeight={bottomSpacerHeight}
                selectedIds={selectedIds}
                focusedTransferId={focusedTransfer?.id ?? null}
                sortKey={sortKey}
                sortDirection={sortDirection}
                draggedColumn={draggedColumn}
                isBatchPaused={isBatchPaused}
                isTransferPaused={isTransferPaused}
                onSelect={handleSelectTransfer}
                onFocus={handleFocusTransfer}
                onToggleTree={toggleTransferTree}
                onSort={(key) => setSort(props.workspaceId, key)}
                onResizeStart={beginColumnResize}
                onDragStart={setDraggedColumn}
                onDragEnd={() => setDraggedColumn(null)}
                onColumnDrop={reorderColumn}
              />
            </div>
            <TransferPagination
              activePageIndex={activePageIndex}
              pageCount={pageCount}
              transferCount={filteredRows.length}
              onPageChange={(pageIndex) => setPageIndex(props.workspaceId, pageIndex)}
            />
          </section>

          {detailVisible ? (
            <aside className={transferStyles.panel} aria-label="Transfer details">
              <TransferDetail
                transfer={focusedTransfer}
                rows={rows}
                working={queueWorking}
                onCancel={handleCancelTransfer}
                onRetry={handleRetryTransfer}
                onPauseResume={handlePauseResumeTransfer}
                onPauseResumeBatch={handlePauseResumeBatchTransfer}
                onCancelBatch={handleCancelBatchTransfer}
                onResolveConflict={handleResolveConflictTransfer}
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
