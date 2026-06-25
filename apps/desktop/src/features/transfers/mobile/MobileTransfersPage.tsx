import {
  Check,
  ChevronDown,
  Filter,
  MoreHorizontal,
  RefreshCcw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  OperationConflictPolicy,
  OperationDescriptor,
  TransferRecord,
  TransferStatus,
  TransferType,
} from "../../../api/types";
import { useProvidersStore } from "../../providers/useProvidersStore";
import { useOperationQueueStore } from "../useOperationQueueStore";
import {
  activeTransferFilterCount,
  createTransferWorkspaceState,
  TRANSFERS_PAGE_SIZE,
  transferStatusMatchesFilter,
  transferTypes,
  type TransferLocationScope,
  type TransferSortDirection,
  type TransferSortKey,
  type TransferStatusFilter,
} from "../useTransfersStore";
import { relativeTime, remoteSummary, transferProgress } from "../transferUtils";
import { useTransfersStore } from "../useTransfersStore";

const emptyOperations: OperationDescriptor[] = [];
const mobileTransferWorkspaceId = "mobile";

export function MobileTransfersPage() {
  const {
    transfers,
    workspaces,
    working,
    error,
    message,
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
    error: state.error,
    message: state.message,
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
  const { providers, loadProviders } = useProvidersStore(useShallow((state) => ({
    providers: state.providers,
    loadProviders: state.load,
  })));
  const {
    snapshot,
    operations,
    queueWorking,
    queueError,
    loadQueue,
    cancel,
    cancelBatch,
    retry,
    undo,
    redo,
    resolveConflict,
    clearTerminal,
  } = useOperationQueueStore(useShallow((state) => ({
    snapshot: state.snapshot,
    operations: state.snapshot?.operations ?? emptyOperations,
    queueWorking: state.working,
    queueError: state.error,
    loadQueue: state.load,
    cancel: state.cancel,
    cancelBatch: state.cancelBatch,
    retry: state.retry,
    undo: state.undo,
    redo: state.redo,
    resolveConflict: state.resolveConflict,
    clearTerminal: state.clearTerminal,
  })));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailTransfer, setDetailTransfer] = useState<TransferRecord | null>(null);

  const workspace = workspaces[mobileTransferWorkspaceId] ?? createTransferWorkspaceState();
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

  useEffect(() => {
    ensureWorkspace(mobileTransferWorkspaceId);
    void load();
    void loadQueue();
  }, [ensureWorkspace, load, loadQueue]);

  useEffect(() => {
    if (!providers) void loadProviders(false);
  }, [loadProviders, providers]);

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
    for (const remote of providers?.remotes ?? []) {
      labels.set(remote.name, `${prettyLabel(remote.type)} · ${remote.name}`);
    }
    return labels;
  }, [providers?.remotes]);
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
  const pageRows = useMemo(
    () => filteredRows.slice(
      activePageIndex * TRANSFERS_PAGE_SIZE,
      (activePageIndex + 1) * TRANSFERS_PAGE_SIZE,
    ),
    [activePageIndex, filteredRows],
  );
  useEffect(() => {
    if (activePageIndex !== pageIndex) setPageIndex(mobileTransferWorkspaceId, activePageIndex);
  }, [activePageIndex, pageIndex, setPageIndex]);
  const operationsByTransfer = useMemo(() => {
    const mapped = new Map<number, OperationDescriptor>();
    for (const operation of operations) {
      if (operation.transferId) mapped.set(operation.transferId, operation);
    }
    return mapped;
  }, [operations]);
  const transferSummary = useMemo(() => summarizeTransfers(rows), [rows]);
  const activeFilterCount = activeTransferFilterCount({ providerFilters, typeFilters, locationScope, statusFilter });
  const visibleIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const visibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const focusedTransfer = detailTransfer
    ?? filteredRows.find((row) => row.id === focusedTransferId)
    ?? null;
  const terminalOperations = operations.filter((operation) => !isActiveOperation(operation));

  const refreshAll = useCallback(async () => {
    await Promise.all([
      load(),
      useOperationQueueStore.getState().load(),
    ]);
  }, [load]);

  const runQueueMutation = useCallback(async (action: Promise<void>) => {
    await action;
    await refreshAll();
  }, [refreshAll]);

  return (
    <section className="mobile-page mobile-transfers-page">
      <div className="mobile-section-header">
        <div>
          <span>Status</span>
          <h2>{filteredRows.length} transfers</h2>
        </div>
        <button type="button" className="mobile-icon-button" disabled={working || queueWorking} onClick={() => void refreshAll()}>
          <RefreshCcw size={18} />
        </button>
      </div>

      <div className="mobile-transfer-summary" aria-label="Transfer summary">
        <MobileTransferSummaryTile label="Visible" value={filteredRows.length} detail={`${rows.length} loaded`} />
        <MobileTransferSummaryTile label="Active" value={transferSummary.active} detail="queued/running" />
        <MobileTransferSummaryTile label="Done" value={transferSummary.completed} detail="completed" />
        <MobileTransferSummaryTile label="Needs action" value={transferSummary.failed + transferSummary.waiting} detail="failed/waiting" />
      </div>

      <label className="mobile-transfer-search">
        <Search size={18} />
        <input
          value={search}
          placeholder="Search transfers"
          onChange={(event) => setSearch(mobileTransferWorkspaceId, event.target.value)}
        />
      </label>

      <div className="mobile-transfer-toolbar">
        <button type="button" onClick={() => setFiltersOpen(true)}>
          <Filter size={16} />
          {activeFilterCount} filters
        </button>
        <button
          type="button"
          disabled={queueWorking || !snapshot?.redoAvailable}
          onClick={() => void runQueueMutation(redo())}
        >
          <RotateCcw size={16} />
          Redo
        </button>
        <button
          type="button"
          disabled={working || selectedIds.size === 0}
          onClick={() => void deleteSelected(mobileTransferWorkspaceId)}
        >
          <Trash2 size={16} />
          Delete selected
        </button>
      </div>

      <MobileOperationQueue
        operations={operations}
        activeCount={snapshot?.activeCount ?? 0}
        maxConcurrent={snapshot?.maxConcurrent ?? 0}
        terminalCount={terminalOperations.length}
        conflict={snapshot?.conflictDialog}
        conflictBatchSize={snapshot?.batches.find((batch) => batch.batchId === snapshot.conflictDialog.batchId)?.operationIds.length ?? 0}
        working={queueWorking}
        error={queueError}
        onRefresh={() => void loadQueue()}
        onClearFinished={() => void runQueueMutation(clearTerminal())}
        onCancel={(operationId) => void runQueueMutation(cancel(operationId))}
        onCancelBatch={(batchId) => void runQueueMutation(cancelBatch(batchId))}
        onRetry={(operationId) => void runQueueMutation(retry(operationId))}
        onResolve={(operationId, policy, applyToBatch) => void runQueueMutation(resolveConflict(operationId, policy, applyToBatch))}
      />

      {error ? <div className="mobile-error">{error}</div> : null}
      {message ? <div className="mobile-success">{message}</div> : null}

      <div className="mobile-transfer-select-row">
        <label>
          <input
            type="checkbox"
            checked={visibleSelected}
            disabled={visibleIds.length === 0}
            onChange={(event) => setTransfersSelected(mobileTransferWorkspaceId, visibleIds, event.currentTarget.checked)}
          />
          <span>{selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select visible"}</span>
        </label>
        <button
          type="button"
          disabled={working || !transfers || transfers.totalCount === 0}
          onClick={() => void deleteAll()}
        >
          Clear history
        </button>
      </div>

      <MobileTransferPagination
        pageIndex={activePageIndex}
        pageCount={pageCount}
        totalCount={filteredRows.length}
        pageSize={TRANSFERS_PAGE_SIZE}
        onPrevious={() => setPageIndex(mobileTransferWorkspaceId, activePageIndex - 1)}
        onNext={() => setPageIndex(mobileTransferWorkspaceId, activePageIndex + 1)}
      />

      <div className="mobile-transfer-list" aria-busy={working || queueWorking}>
        {filteredRows.length === 0 ? (
          <div className="mobile-empty-state">
            <h3>No transfers</h3>
            <p>{activeFilterCount > 0 || search.trim() ? "No transfer history matches this view." : "Recent transfer activity will appear here."}</p>
          </div>
        ) : pageRows.map((row) => {
          const operation = operationsByTransfer.get(row.id);
          return (
            <MobileTransferCard
              key={row.id}
              row={row}
              operation={operation}
              selected={selectedIds.has(row.id)}
              disabled={queueWorking}
              onSelect={(checked) => toggleTransfer(mobileTransferWorkspaceId, row.id, checked)}
              onOpen={() => {
                setFocusedTransfer(mobileTransferWorkspaceId, row.id);
                setDetailTransfer(row);
              }}
              onCancel={(operationId) => void runQueueMutation(cancel(operationId))}
              onRetry={(operationId) => void runQueueMutation(retry(operationId))}
              onUndo={(undoTokenId) => void runQueueMutation(undo(undoTokenId))}
            />
          );
        })}
      </div>

      <MobileTransferPagination
        pageIndex={activePageIndex}
        pageCount={pageCount}
        totalCount={filteredRows.length}
        pageSize={TRANSFERS_PAGE_SIZE}
        onPrevious={() => setPageIndex(mobileTransferWorkspaceId, activePageIndex - 1)}
        onNext={() => setPageIndex(mobileTransferWorkspaceId, activePageIndex + 1)}
      />

      {filtersOpen ? (
        <MobileTransferFiltersSheet
          providerGroups={providerGroups}
          providerFilters={providerFilters}
          typeFilters={typeFilters}
          locationScope={locationScope}
          statusFilter={statusFilter}
          sortKey={sortKey}
          sortDirection={sortDirection}
          activeFilterCount={activeFilterCount}
          onClose={() => setFiltersOpen(false)}
          onToggleProvider={(provider) => toggleProviderFilter(mobileTransferWorkspaceId, provider)}
          onToggleType={(type) => toggleTypeFilter(mobileTransferWorkspaceId, type)}
          onLocationScope={(scope) => setLocationScope(mobileTransferWorkspaceId, scope)}
          onStatusFilter={(filter) => setStatusFilter(mobileTransferWorkspaceId, filter)}
          onSort={(key, direction) => setSort(mobileTransferWorkspaceId, key, direction)}
          onClear={() => clearFilters(mobileTransferWorkspaceId)}
        />
      ) : null}

      {focusedTransfer ? (
        <MobileTransferDetailSheet
          row={focusedTransfer}
          operation={operationsByTransfer.get(focusedTransfer.id)}
          working={queueWorking}
          onClose={() => {
            setDetailTransfer(null);
            setFocusedTransfer(mobileTransferWorkspaceId, null);
          }}
          onCancel={(operationId) => void runQueueMutation(cancel(operationId))}
          onRetry={(operationId) => void runQueueMutation(retry(operationId))}
          onUndo={(undoTokenId) => void runQueueMutation(undo(undoTokenId))}
        />
      ) : null}
    </section>
  );
}

function MobileTransferSummaryTile(props: { label: string; value: number; detail: string }) {
  return (
    <div className="mobile-transfer-summary-tile">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  );
}

function MobileTransferPagination(props: {
  pageIndex: number;
  pageCount: number;
  totalCount: number;
  pageSize: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const start = props.totalCount === 0 ? 0 : props.pageIndex * props.pageSize + 1;
  const end = Math.min(props.totalCount, (props.pageIndex + 1) * props.pageSize);
  return (
    <nav className="mobile-transfer-pagination" aria-label="Transfer pages">
      <span>
        {props.totalCount === 0
          ? "No transfers"
          : `${start}-${end} of ${props.totalCount} · Page ${props.pageIndex + 1}/${props.pageCount}`}
      </span>
      <div>
        <button type="button" disabled={props.pageIndex === 0 || props.totalCount === 0} onClick={props.onPrevious}>
          Previous
        </button>
        <button type="button" disabled={props.pageIndex + 1 >= props.pageCount || props.totalCount === 0} onClick={props.onNext}>
          Next
        </button>
      </div>
    </nav>
  );
}

function MobileOperationQueue(props: {
  operations: OperationDescriptor[];
  activeCount: number;
  maxConcurrent: number;
  terminalCount: number;
  conflict?: {
    open: boolean;
    operationId: number;
    batchId: number;
    applyToBatch: boolean;
    supportsReplace: boolean;
    supportsKeepBoth: boolean;
    title: string;
    sourceLabel: string;
    targetLabel: string;
  };
  conflictBatchSize: number;
  working: boolean;
  error: string | null;
  onRefresh: () => void;
  onClearFinished: () => void;
  onCancel: (operationId: number) => void;
  onCancelBatch: (batchId: number) => void;
  onRetry: (operationId: number) => void;
  onResolve: (operationId: number, policy: OperationConflictPolicy, applyToBatch: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [applyToBatch, setApplyToBatch] = useState(true);

  useEffect(() => {
    if (props.conflict?.open) setApplyToBatch(props.conflict.applyToBatch);
  }, [props.conflict?.applyToBatch, props.conflict?.open, props.conflict?.operationId]);

  const visibleOperations = expanded ? props.operations : props.operations.slice(0, 2);
  const canApplyToBatch = props.conflictBatchSize > 1;

  return (
    <section className="mobile-operation-queue">
      <header>
        <button type="button" onClick={() => setExpanded((open) => !open)}>
          <ChevronDown size={16} className={expanded ? "open" : ""} />
          <span>Queue</span>
          <strong>{props.activeCount} active</strong>
        </button>
        <div>
          <button type="button" disabled={props.working} aria-label="Refresh queue" onClick={props.onRefresh}>
            <RefreshCcw size={15} />
          </button>
          <button type="button" disabled={props.working || props.terminalCount === 0} aria-label="Clear finished operations" onClick={props.onClearFinished}>
            <Trash2 size={15} />
          </button>
        </div>
      </header>
      {props.error ? <p className="mobile-operation-error">{props.error}</p> : null}
      {props.conflict?.open ? (
        <div className="mobile-operation-conflict">
          <strong>{props.conflict.title || "Resolve conflict"}</strong>
          <span>{props.conflict.sourceLabel} {"->"} {props.conflict.targetLabel}</span>
          <label>
            <input
              type="checkbox"
              checked={canApplyToBatch && applyToBatch}
              disabled={props.working || !canApplyToBatch}
              onChange={(event) => setApplyToBatch(event.currentTarget.checked)}
            />
            Apply to batch
          </label>
          <div>
            <button type="button" disabled={props.working} onClick={() => props.onCancel(props.conflict!.operationId)}>Cancel</button>
            {canApplyToBatch ? (
              <button type="button" disabled={props.working} onClick={() => props.onCancelBatch(props.conflict!.batchId)}>Cancel batch</button>
            ) : null}
            {props.conflict.supportsReplace ? (
              <button type="button" disabled={props.working} onClick={() => props.onResolve(props.conflict!.operationId, "replace", canApplyToBatch && applyToBatch)}>Replace</button>
            ) : null}
            <button type="button" disabled={props.working} onClick={() => props.onResolve(props.conflict!.operationId, "skip", canApplyToBatch && applyToBatch)}>Skip</button>
            {props.conflict.supportsKeepBoth ? (
              <button type="button" disabled={props.working} onClick={() => props.onResolve(props.conflict!.operationId, "keep_both", canApplyToBatch && applyToBatch)}>Keep both</button>
            ) : null}
          </div>
        </div>
      ) : null}
      {expanded && props.operations.length === 0 ? <p className="mobile-operation-empty">No queued operations.</p> : null}
      {visibleOperations.length > 0 ? (
        <div className="mobile-operation-list">
          {visibleOperations.map((operation) => (
            <div key={operation.operationId} className="mobile-operation-row">
              <span>
                <strong>{operation.title || prettyLabel(operation.kind)}</strong>
                <small>{operationEndpointLabel(operation.source)} {"->"} {operationEndpointLabel(operation.target)}</small>
              </span>
              <em>{prettyLabel(operation.status)}</em>
              <button type="button" disabled={!operation.cancelable || props.working} onClick={() => props.onCancel(operation.operationId)}>
                <XCircle size={14} />
              </button>
              <button type="button" disabled={!operation.retryable || operation.status !== "failed" || props.working} onClick={() => props.onRetry(operation.operationId)}>
                <RotateCcw size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {props.operations.length > 2 ? (
        <button type="button" className="mobile-operation-expand" onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Show less" : `Show ${props.operations.length - 2} more`}
        </button>
      ) : null}
      <footer>{props.terminalCount} finished · {props.maxConcurrent} max</footer>
    </section>
  );
}

function MobileTransferCard(props: {
  row: TransferRecord;
  operation?: OperationDescriptor;
  selected: boolean;
  disabled: boolean;
  onSelect: (checked: boolean) => void;
  onOpen: () => void;
  onCancel: (operationId: number) => void;
  onRetry: (operationId: number) => void;
  onUndo: (undoTokenId: number) => void;
}) {
  return (
    <article className={`mobile-transfer-card ${props.row.status}${props.selected ? " selected" : ""}`}>
      <div className="mobile-transfer-card-top">
        <label aria-label={`Select ${primaryTransferLabel(props.row)}`}>
          <input type="checkbox" checked={props.selected} onChange={(event) => props.onSelect(event.currentTarget.checked)} />
        </label>
        <button type="button" onClick={props.onOpen}>
          <strong>{primaryTransferLabel(props.row)}</strong>
          <span>{prettyLabel(props.row.transferType)} · {secondaryTransferLabel(props.row)}</span>
        </button>
        <button type="button" aria-label={`Details for ${primaryTransferLabel(props.row)}`} onClick={props.onOpen}>
          <MoreHorizontal size={19} />
        </button>
      </div>
      <div className="mobile-transfer-meta">
        <span>{prettyLabel(props.row.status)}</span>
        <span>{transferProgress(props.row)}</span>
        <span>{relativeTime(transferTime(props.row))}</span>
      </div>
      {(props.operation?.cancelable || props.operation?.retryable || (props.row.undoable && props.row.undoTokenId)) ? (
        <div className="mobile-transfer-actions">
          {props.operation?.cancelable ? (
            <button type="button" disabled={props.disabled} onClick={() => props.onCancel(props.operation!.operationId)}>
              <XCircle size={16} /> Cancel
            </button>
          ) : null}
          {props.operation?.retryable && props.operation.status === "failed" ? (
            <button type="button" disabled={props.disabled} onClick={() => props.onRetry(props.operation!.operationId)}>
              <RotateCcw size={16} /> Retry
            </button>
          ) : null}
          {props.row.undoable && props.row.undoTokenId ? (
            <button type="button" disabled={props.disabled} onClick={() => props.onUndo(props.row.undoTokenId)}>
              <Undo2 size={16} /> Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function MobileTransferFiltersSheet(props: {
  providerGroups: Array<{ key: string; label: string; count: number }>;
  providerFilters: Set<string>;
  typeFilters: Set<TransferType>;
  locationScope: TransferLocationScope;
  statusFilter: TransferStatusFilter;
  sortKey: TransferSortKey;
  sortDirection: TransferSortDirection;
  activeFilterCount: number;
  onClose: () => void;
  onToggleProvider: (provider: string) => void;
  onToggleType: (type: TransferType) => void;
  onLocationScope: (scope: TransferLocationScope) => void;
  onStatusFilter: (filter: TransferStatusFilter) => void;
  onSort: (key: TransferSortKey, direction?: TransferSortDirection) => void;
  onClear: () => void;
}) {
  return (
    <div className="mobile-sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="mobile-detail-sheet mobile-transfer-filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Transfer filters"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Filters</span>
            <h2>{props.activeFilterCount} active</h2>
          </div>
          <button type="button" className="mobile-icon-button" aria-label="Close" onClick={props.onClose}>
            <X size={20} />
          </button>
        </header>
        <MobileFilterSection title="Providers">
          {props.providerGroups.length === 0 ? <p>No remote providers in transfer history.</p> : null}
          {props.providerGroups.map((group) => (
            <MobileFilterCheck
              key={group.key}
              label={group.label}
              detail={`${group.count}`}
              checked={props.providerFilters.has(group.key)}
              onChange={() => props.onToggleProvider(group.key)}
            />
          ))}
        </MobileFilterSection>
        <MobileFilterSection title="Transfer Type">
          <div className="mobile-transfer-chip-grid">
            {transferTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={props.typeFilters.has(type) ? "selected" : ""}
                onClick={() => props.onToggleType(type)}
              >
                {props.typeFilters.has(type) ? <Check size={14} /> : null}
                {prettyLabel(type)}
              </button>
            ))}
          </div>
        </MobileFilterSection>
        <MobileFilterSection title="Location">
          <div className="mobile-transfer-segmented">
            {(["all", "local", "remote"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                className={props.locationScope === scope ? "selected" : ""}
                onClick={() => props.onLocationScope(scope)}
              >
                {scope === "all" ? "All" : scope === "local" ? "Local" : "Remote"}
              </button>
            ))}
          </div>
        </MobileFilterSection>
        <MobileFilterSection title="Status">
          <div className="mobile-transfer-segmented">
            {(["all", "active", "completed", "failed"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                className={props.statusFilter === filter ? "selected" : ""}
                onClick={() => props.onStatusFilter(filter)}
              >
                {prettyLabel(filter)}
              </button>
            ))}
          </div>
        </MobileFilterSection>
        <MobileFilterSection title="Sort">
          <label className="mobile-transfer-select">
            <SlidersHorizontal size={16} />
            <select
              value={props.sortKey}
              onChange={(event) => props.onSort(event.target.value as TransferSortKey, props.sortDirection)}
            >
              <option value="time">Time</option>
              <option value="name">Name</option>
              <option value="operation">Operation</option>
              <option value="status">Status</option>
            </select>
          </label>
          <div className="mobile-transfer-segmented">
            {(["asc", "desc"] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                className={props.sortDirection === direction ? "selected" : ""}
                onClick={() => props.onSort(props.sortKey, direction)}
              >
                {direction === "asc" ? "Asc" : "Desc"}
              </button>
            ))}
          </div>
        </MobileFilterSection>
        <div className="mobile-action-stack">
          <button type="button" className="mobile-secondary-action" disabled={props.activeFilterCount === 0} onClick={props.onClear}>
            Clear filters
          </button>
        </div>
      </section>
    </div>
  );
}

function MobileFilterSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="mobile-transfer-filter-section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function MobileFilterCheck(props: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="mobile-transfer-filter-check">
      <input type="checkbox" checked={props.checked} onChange={props.onChange} />
      <span>{props.label}</span>
      {props.detail ? <em>{props.detail}</em> : null}
    </label>
  );
}

function MobileTransferDetailSheet(props: {
  row: TransferRecord;
  operation?: OperationDescriptor;
  working: boolean;
  onClose: () => void;
  onCancel: (operationId: number) => void;
  onRetry: (operationId: number) => void;
  onUndo: (undoTokenId: number) => void;
}) {
  return (
    <div className="mobile-sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="mobile-detail-sheet mobile-transfer-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Transfer details for ${primaryTransferLabel(props.row)}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{prettyLabel(props.row.transferType)}</span>
            <h2>{primaryTransferLabel(props.row)}</h2>
          </div>
          <button type="button" className="mobile-icon-button" aria-label="Close" onClick={props.onClose}>
            <X size={20} />
          </button>
        </header>
        <dl className="mobile-detail-list">
          <MobileTransferDetailRow label="Status" value={prettyLabel(props.row.status)} />
          <MobileTransferDetailRow label="Provider" value={remoteSummary(props.row)} />
          <MobileTransferDetailRow label="Source" value={sourceEndpoint(props.row) || "--"} />
          <MobileTransferDetailRow label="Destination" value={targetEndpoint(props.row) || "--"} />
          <MobileTransferDetailRow label="Progress" value={`${transferProgress(props.row)} · ${props.row.transferredBytes} / ${props.row.totalBytes} bytes`} />
          <MobileTransferDetailRow label="Queued" value={timestampLabel(props.row.queuedAtMs)} />
          <MobileTransferDetailRow label="Started" value={timestampLabel(props.row.startedAtMs)} />
          <MobileTransferDetailRow label="Completed" value={timestampLabel(props.row.completedAtMs)} />
          <MobileTransferDetailRow label="Job ID" value={`J-${props.row.jobId}`} />
          {props.row.detailMessage ? <MobileTransferDetailRow label="Detail" value={props.row.detailMessage} /> : null}
          {props.row.errorMessage ? <MobileTransferDetailRow label="Error" value={props.row.errorMessage} danger /> : null}
        </dl>
        <div className="mobile-transfer-actions">
          {props.operation?.cancelable ? (
            <button type="button" disabled={props.working} onClick={() => props.onCancel(props.operation!.operationId)}>
              <XCircle size={16} /> Cancel
            </button>
          ) : null}
          {props.operation?.retryable && props.operation.status === "failed" ? (
            <button type="button" disabled={props.working} onClick={() => props.onRetry(props.operation!.operationId)}>
              <RotateCcw size={16} /> Retry
            </button>
          ) : null}
          {props.row.undoable && props.row.undoTokenId ? (
            <button type="button" disabled={props.working} onClick={() => props.onUndo(props.row.undoTokenId)}>
              <Undo2 size={16} /> Undo
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function MobileTransferDetailRow(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={props.danger ? "danger" : undefined}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
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
    locationScope: TransferLocationScope;
    statusFilter: TransferStatusFilter;
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
  const direction = filters.sortDirection === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => direction * compareTransfers(left, right, filters.sortKey));
}

function compareTransfers(left: TransferRecord, right: TransferRecord, key: TransferSortKey): number {
  if (key === "name") return primaryTransferLabel(left).localeCompare(primaryTransferLabel(right));
  if (key === "operation") return left.transferType.localeCompare(right.transferType);
  if (key === "status") return left.status.localeCompare(right.status);
  return transferTime(left) - transferTime(right);
}

function isActiveOperation(operation: OperationDescriptor): boolean {
  return operation.status === "queued" || operation.status === "in_progress" || operation.status === "waiting_for_resolution";
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

function operationEndpointLabel(endpoint: OperationDescriptor["source"]): string {
  return endpoint.localPath || `${endpoint.remoteName}:${endpoint.remotePath || "/"}`;
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

function prettyLabel(value: TransferStatus | TransferType | string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
