import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  CircleDashed,
  FolderOpen,
  Pause,
  Play,
  PlugZap,
  RefreshCcw,
  RotateCcw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { TransferRecord, TransferStatus, TransferType } from "../../../api/types";
import { errorText, prettyLabel } from "../../../shared/format";
import {
  mobileEmptyIconClass,
  mobileEmptyStateClass,
  mobileErrorClass,
  mobilePageClass,
  mobileSectionEyebrowClass,
  mobileSectionHeaderClass,
  mobileSectionTitleClass,
  mobileSuccessClass,
} from "../../../shared/mobileStyles";
import { useOperationQueueStore } from "../../../stores/useOperationQueueStore";
import {
  activeTransferFilterCount,
  createTransferWorkspaceState,
  transferStatusMatchesFilter,
  transferTypes,
  useTransfersStore,
  type TransferStatusFilter,
} from "../../../stores/useTransfersStore";
import { relativeTime, remoteSummary } from "../transferUtils";

const mobileTransfersWorkspaceId = "mobile-transfers";
const mobileActiveTransferPollMs = 2_000;
const statusFilters: Array<{ value: TransferStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Done" },
  { value: "failed", label: "Needs attention" },
];

const searchClass = "mb-3 grid h-[48px] grid-cols-[22px_minmax(0,1fr)] items-center gap-2.5 rounded-[15px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-[var(--misty-text-muted)]";
const filterScrollerClass = "-mx-0.5 mb-3 flex gap-2 overflow-x-auto px-0.5 pb-1 [-webkit-overflow-scrolling:touch]";
const filterButtonClass = "min-h-11 shrink-0 rounded-full border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm font-bold text-[var(--misty-text-muted)] disabled:opacity-55";
const filterButtonActiveClass = "border-[var(--misty-primary)] bg-[color-mix(in_srgb,var(--misty-primary)_18%,transparent)] text-[var(--misty-text)]";
const iconButtonClass = "grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-text)] disabled:opacity-45";
const rowClass = "grid gap-2 border-0 border-b border-[var(--misty-border-soft)] py-3.5";
const rowHeaderClass = "grid min-w-0 grid-cols-[42px_minmax(0,1fr)] items-start gap-3";
const actionButtonClass = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[11px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 text-xs font-bold text-[var(--misty-text)] disabled:opacity-45";
const emptyActionClass = "inline-flex min-h-11 w-full max-w-[260px] items-center justify-center gap-2 rounded-[13px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-3 text-sm font-bold text-[var(--misty-text)]";

export function MobileTransfersPage() {
  const navigate = useNavigate();
  const {
    transfers,
    workspaces,
    working,
    error,
    message,
    load,
    ensureWorkspace,
    setSearch,
    toggleTypeFilter,
    setStatusFilter,
    clearFilters,
    deleteIds,
  } = useTransfersStore(useShallow((state) => ({
    transfers: state.transfers,
    workspaces: state.workspaces,
    working: state.working,
    error: state.error,
    message: state.message,
    load: state.load,
    ensureWorkspace: state.ensureWorkspace,
    setSearch: state.setSearch,
    toggleTypeFilter: state.toggleTypeFilter,
    setStatusFilter: state.setStatusFilter,
    clearFilters: state.clearFilters,
    deleteIds: state.deleteIds,
  })));
  const queue = useOperationQueueStore(useShallow((state) => ({
    snapshot: state.snapshot,
    working: state.working,
    error: state.error,
    load: state.load,
    pause: state.pause,
    resume: state.resume,
    cancel: state.cancel,
    retryTransfer: state.retryTransfer,
  })));
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoadGraceElapsed, setInitialLoadGraceElapsed] = useState(false);
  const workspace = workspaces[mobileTransfersWorkspaceId] ?? createTransferWorkspaceState();
  const loadQueue = queue.load;

  useEffect(() => {
    ensureWorkspace(mobileTransfersWorkspaceId);
    void load();
    void loadQueue();
  }, [ensureWorkspace, load, loadQueue]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setInitialLoadGraceElapsed(true), 1600);
    return () => window.clearTimeout(timeout);
  }, []);

  const allRows = transfers?.rows ?? [];
  const hasLiveTransferWork = useMemo(
    () => allRows.some(isMobileLiveTransfer) || (queue.snapshot?.activeCount ?? 0) > 0,
    [allRows, queue.snapshot?.activeCount],
  );

  useEffect(() => {
    if (!hasLiveTransferWork) return;

    let disposed = false;
    let timer: number | null = null;
    const schedule = () => {
      timer = window.setTimeout(() => {
        void poll();
      }, mobileActiveTransferPollMs);
    };
    const poll = async () => {
      if (disposed) return;
      if (!document.hidden) {
        await Promise.all([
          load(workspace.search, { silent: true }),
          loadQueue({ silent: true }),
        ]);
      }
      if (!disposed) schedule();
    };

    schedule();
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [hasLiveTransferWork, load, loadQueue, workspace.search]);

  const visibleRows = useMemo(
    () => filterMobileTransfers(allRows, workspace),
    [allRows, workspace],
  );
  const summary = useMemo(() => summarizeMobileTransfers(allRows), [allRows]);
  const activeFilterCount = activeTransferFilterCount(workspace);
  const showFilterControls = allRows.length > 0 || activeFilterCount > 0 || workspace.search.trim().length > 0;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        load(workspace.search, { force: true }),
        useOperationQueueStore.getState().load({ force: true }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [load, workspace.search]);

  const runQueueAction = useCallback(async (action: () => Promise<void>) => {
    await action();
    await Promise.all([
      load(workspace.search, { silent: true, force: true }),
      useOperationQueueStore.getState().load({ silent: true, force: true }),
    ]);
  }, [load, workspace.search]);

  return (
    <section className={`${mobilePageClass} scroll-smooth`}>
      {error ? <div className={mobileErrorClass}>{error}</div> : null}
      {queue.error ? <div className={mobileErrorClass}>{queue.error}</div> : null}
      {message ? <div className={mobileSuccessClass}>{message}</div> : null}

      <header className="mb-3.5 grid min-w-0 grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3">
        <div className="grid h-[52px] w-[52px] place-items-center rounded-2xl bg-[#86b7ff24] text-[#cfe2ff]">
          <ArrowDownToLine size={28} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <span className={mobileSectionEyebrowClass}>Sync activity</span>
          <h2 className="m-0 mb-1 truncate text-2xl font-black leading-[1.1] text-[var(--misty-text)]">
            {summary.active > 0 ? `${summary.active} active` : "Transfers"}
          </h2>
          <p className="m-0 text-[13px] leading-[1.35] text-[var(--misty-text-muted)]">
            {summary.total} recorded operations
          </p>
        </div>
        <button
          type="button"
          className={iconButtonClass}
          aria-label="Refresh transfers"
          disabled={working || refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCcw className={refreshing ? "animate-spin" : undefined} size={19} />
        </button>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <SummaryTile label="Active" value={summary.active} tone="active" />
        <SummaryTile label="Complete" value={summary.completed} tone="good" />
        <SummaryTile label="Attention" value={summary.failed} tone={summary.failed > 0 ? "warn" : undefined} />
        <SummaryTile label="Queued" value={summary.queued} />
      </div>

      {showFilterControls ? (
        <>
          <label className={searchClass}>
            <Search size={19} />
            <input
              className="h-full min-w-0 border-0 bg-transparent text-base text-[var(--misty-text)] outline-none placeholder:text-[var(--misty-text-subtle)]"
              value={workspace.search}
              placeholder="Search transfers"
              autoCapitalize="none"
              onChange={(event) => setSearch(mobileTransfersWorkspaceId, event.target.value)}
            />
          </label>

          <div className={filterScrollerClass} aria-label="Transfer status filters">
            {statusFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`${filterButtonClass} ${workspace.statusFilter === filter.value ? filterButtonActiveClass : ""}`}
                onClick={() => setStatusFilter(mobileTransfersWorkspaceId, filter.value)}
              >
                {filter.label}
              </button>
            ))}
            {activeFilterCount > 0 ? (
              <button type="button" className={filterButtonClass} onClick={() => clearFilters(mobileTransfersWorkspaceId)}>
                Clear {activeFilterCount}
              </button>
            ) : null}
          </div>

          <div className="mb-3 flex flex-wrap gap-2" aria-label="Transfer type filters">
            {transferTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={`${filterButtonClass} ${workspace.typeFilters.has(type) ? filterButtonActiveClass : ""}`}
                onClick={() => toggleTypeFilter(mobileTransfersWorkspaceId, type)}
              >
                {prettyLabel(type)}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <section>
        <div className={mobileSectionHeaderClass}>
          <div>
            <span className={mobileSectionEyebrowClass}>History</span>
            <h2 className={mobileSectionTitleClass}>{visibleRows.length} visible</h2>
          </div>
        </div>

        {working && allRows.length === 0 && !initialLoadGraceElapsed ? (
          <div className="grid gap-0">
            <div className="min-h-[92px] border-b border-[var(--misty-border-soft)] py-3 opacity-70" />
            <div className="min-h-[92px] border-b border-[var(--misty-border-soft)] py-3 opacity-50" />
          </div>
        ) : visibleRows.length > 0 ? (
          <div className="grid gap-0">
            {visibleRows.slice(0, 80).map((row) => (
              <TransferRow
                key={row.id}
                row={row}
                disabled={queue.working}
                onPauseResume={() => runQueueAction(() => row.paused ? queue.resume(row.operationId) : queue.pause(row.operationId))}
                onCancel={() => runQueueAction(() => queue.cancel(row.operationId))}
                onRetry={() => runQueueAction(() => queue.retryTransfer(row.id))}
                onDelete={() => deleteIds(mobileTransfersWorkspaceId, [row.id])}
              />
            ))}
          </div>
        ) : (
          <div className={mobileEmptyStateClass}>
            <div className={mobileEmptyIconClass}>
              <CircleDashed size={31} strokeWidth={1.7} />
            </div>
            <h3>No transfers to show</h3>
            <p>{allRows.length > 0 ? "Try clearing filters or search." : "New transfer activity will appear here."}</p>
            {allRows.length === 0 ? (
              <div className="mt-2 grid w-full place-items-center gap-2">
                <button type="button" className={emptyActionClass} onClick={() => navigate("/files")}>
                  <FolderOpen size={17} /> Browse files
                </button>
                <button type="button" className={emptyActionClass} onClick={() => navigate("/providers")}>
                  <PlugZap size={17} /> Connect remotes
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}

function TransferRow(props: {
  row: TransferRecord;
  disabled: boolean;
  onPauseResume: () => Promise<void>;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const row = props.row;
  const canPauseResume = row.operationId > 0 && (row.status === "queued" || row.status === "pending" || row.status === "in_progress" || row.status === "waiting_for_resolution");
  const progress = transferPercent(row);
  const label = primaryTransferLabel(row);

  return (
    <article className={rowClass}>
      <div className={rowHeaderClass}>
        <div className="grid h-[42px] w-[42px] place-items-center rounded-[14px] border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] text-[var(--misty-primary)]">
          {row.transferType === "upload" ? <ArrowUpFromLine size={20} /> : <ArrowDownToLine size={20} />}
        </div>
        <div className="grid min-w-0 gap-1">
          <h3 className="m-0 truncate text-base font-black leading-tight text-[var(--misty-text)]">{label}</h3>
          <p className="m-0 mt-1 truncate text-[12px] leading-tight text-[var(--misty-text-muted)]">
            {prettyLabel(row.transferType)} · {remoteSummary(row)} · {relativeTime(transferTime(row))}
          </p>
          <span className={statusBadgeClass(row.status)}>{statusLabel(row.status)}</span>
        </div>
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--misty-surface-2)]"
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={progress == null ? undefined : 100}
        aria-valuenow={progress ?? undefined}
      >
        <div
          className={`h-full rounded-full bg-[var(--misty-primary)] ${progress == null ? "w-1/3 opacity-55" : ""}`}
          style={progress == null ? undefined : { width: `${progress}%` }}
        />
      </div>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs text-[var(--misty-text-muted)]">
        <span className="min-w-0 truncate">{secondaryTransferLabel(row)}</span>
        <strong className="text-[var(--misty-text)]">{progress == null ? formatBytes(row.transferredBytes) : `${progress}%`}</strong>
      </div>

      {row.errorMessage ? <p className="m-0 text-xs leading-relaxed text-[#fca5a5]">{row.errorMessage}</p> : null}

      <div className="flex min-w-0 flex-wrap gap-2">
        {row.operationId > 0 ? (
          <>
            <button type="button" className={actionButtonClass} disabled={!canPauseResume || props.disabled} onClick={() => void props.onPauseResume()}>
              {row.paused ? <Play size={14} /> : <Pause size={14} />} {row.paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className={actionButtonClass} disabled={!row.cancelable || props.disabled} onClick={() => void props.onCancel()}>
              <XCircle size={14} /> Cancel
            </button>
          </>
        ) : null}
        <button type="button" className={actionButtonClass} disabled={!row.retryable || props.disabled} onClick={() => void props.onRetry()}>
          <RotateCcw size={14} /> Retry
        </button>
        <button type="button" className={actionButtonClass} disabled={props.disabled} onClick={() => void props.onDelete()}>
          <Trash2 size={14} /> Remove
        </button>
      </div>
    </article>
  );
}

function SummaryTile(props: { label: string; value: number; tone?: "active" | "good" | "warn" }) {
  const Icon = props.tone === "good" ? CheckCircle2 : props.tone === "warn" ? AlertCircle : RefreshCcw;
  const toneClass = props.tone === "good"
    ? "text-[#86efac]"
    : props.tone === "warn"
      ? "text-[#fca5a5]"
      : props.tone === "active"
        ? "text-[#cfe2ff]"
        : "text-[var(--misty-text-muted)]";
  return (
    <div className="grid min-w-0 gap-1.5 border-b border-[var(--misty-border-soft)] pb-2">
      <span className="flex items-center gap-1.5 text-xs font-bold uppercase text-[var(--misty-text-subtle)]">
        <Icon className={toneClass} size={14} /> {props.label}
      </span>
      <strong className="text-2xl leading-none text-[var(--misty-text)]">{props.value}</strong>
    </div>
  );
}

function filterMobileTransfers(rows: TransferRecord[], workspace: ReturnType<typeof createTransferWorkspaceState>): TransferRecord[] {
  const query = workspace.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (workspace.typeFilters.size > 0 && !workspace.typeFilters.has(row.transferType)) return false;
    if (!transferStatusMatchesFilter(row.status, workspace.statusFilter)) return false;
    if (!query) return true;
    return [
      row.fileName,
      row.queueTitle,
      row.transferType,
      row.status,
      row.localSourcePath,
      row.localDestPath,
      row.remoteSourceName,
      row.remoteSourcePath,
      row.remoteDestName,
      row.remoteDestPath,
      row.errorMessage,
      row.detailMessage,
    ].join(" ").toLowerCase().includes(query);
  });
}

function summarizeMobileTransfers(rows: TransferRecord[]) {
  let active = 0;
  let completed = 0;
  let failed = 0;
  let queued = 0;
  for (const row of rows) {
    if (row.status === "completed") completed += 1;
    else if (row.status === "failed" || row.status === "canceled" || row.status === "interrupted") failed += 1;
    else if (row.status === "queued" || row.status === "pending") queued += 1;
    else active += 1;
  }
  return { active, completed, failed, queued, total: rows.length };
}

function isMobileLiveTransfer(row: TransferRecord): boolean {
  return row.status === "queued"
    || row.status === "pending"
    || row.status === "in_progress"
    || row.status === "waiting_for_resolution";
}

function transferPercent(row: TransferRecord): number | null {
  if (row.transferType === "archive" || row.transferType === "create" || row.transferType === "rename" || row.transferType === "delete") {
    return row.status === "completed" ? 100 : row.status === "failed" || row.status === "canceled" ? 0 : null;
  }
  if (row.totalBytes <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((row.transferredBytes / row.totalBytes) * 100)));
}

function statusBadgeClass(status: TransferStatus): string {
  const base = "inline-flex w-fit max-w-full shrink-0 truncate rounded-full px-2 py-1 text-[11px] font-bold leading-none capitalize";
  if (status === "completed") return `${base} bg-[color-mix(in_srgb,var(--misty-success)_16%,transparent)] text-[#86efac]`;
  if (status === "failed" || status === "canceled" || status === "interrupted") return `${base} bg-[color-mix(in_srgb,var(--misty-danger)_16%,transparent)] text-[#fca5a5]`;
  return `${base} bg-[color-mix(in_srgb,var(--misty-primary)_16%,transparent)] text-[#cfe2ff]`;
}

function statusLabel(status: TransferStatus): string {
  if (status === "in_progress") return "Running";
  if (status === "waiting_for_resolution") return "Review";
  return prettyLabel(status);
}

function transferTime(row: TransferRecord): number {
  return row.completedAtMs || row.startedAtMs || row.queuedAtMs || 0;
}

function primaryTransferLabel(row: TransferRecord): string {
  if (row.fileName) return row.fileName;
  const target = row.remoteDestPath || row.localDestPath || row.remoteSourcePath || row.localSourcePath;
  return basename(target) || row.queueTitle || "Transfer";
}

function secondaryTransferLabel(row: TransferRecord): string {
  const source = row.remoteSourceName ? `${row.remoteSourceName}:${row.remoteSourcePath || "/"}` : row.localSourcePath;
  const target = row.remoteDestName ? `${row.remoteDestName}:${row.remoteDestPath || "/"}` : row.localDestPath;
  return [source, target].filter(Boolean).join(" -> ") || row.detailMessage || `Job ${row.jobId}`;
}

function basename(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"), clean.lastIndexOf(":"));
  return index >= 0 ? clean.slice(index + 1) : clean;
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

export default MobileTransfersPage;
