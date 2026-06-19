import { RefreshCcw, RotateCcw, Search, Trash2, XCircle } from "lucide-react";
import { useEffect } from "react";
import { prettyLabel } from "../../shared/format";
import { relativeTime, remoteSummary, transferProgress } from "./transferUtils";
import { useOperationQueueStore } from "./useOperationQueueStore";
import { useTransfersStore } from "./useTransfersStore";

export function TransfersWorkspace() {
  const {
    transfers,
    search,
    selectedIds,
    working,
    setSearch,
    load,
    toggleTransfer,
    deleteSelected,
    deleteAll,
  } = useTransfersStore();
  const queue = useOperationQueueStore();

  useEffect(() => {
    void load();
    void queue.load();
    const interval = window.setInterval(() => {
      void load(undefined, { silent: true });
      void useOperationQueueStore.getState().load({ silent: true });
    }, 1500);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <section className="panel transfers-panel">
      <div className="panel-header transfers-header">
        <div>
          <h2>Transfers</h2>
          <p>{transfers ? `${transfers.totalCount} history rows · ${transfers.dbPath}` : "Loading transfer history"}</p>
        </div>
        <div className="transfer-toolbar">
          <label className="search-box">
            <Search size={16} />
            <input value={search} placeholder="Search transfers" onChange={(event) => setSearch(event.target.value)} />
          </label>
          <button onClick={() => void load()} disabled={working}>
            <RefreshCcw size={16} />
            Refresh
          </button>
          <button onClick={() => void deleteSelected()} disabled={working || selectedIds.size === 0}>
            <Trash2 size={16} />
            Delete Selected
          </button>
          <button className="danger" onClick={() => void deleteAll()} disabled={working || !transfers || transfers.totalCount === 0}>
            <Trash2 size={16} />
            Delete All
          </button>
        </div>
      </div>

      <div className="transfer-table-wrap">
        <OperationQueueStrip />
        <table className="transfer-table">
          <thead>
            <tr>
              <th className="checkbox-cell"></th>
              <th>Transfer</th>
              <th>Operation</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Time</th>
              <th>Remote</th>
            </tr>
          </thead>
          <tbody>
            {transfers?.rows.map((row) => (
              <tr key={row.id}>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={(event) => toggleTransfer(row.id, event.target.checked)}
                  />
                </td>
                <td>
                  <strong>{row.fileName || "Untitled transfer"}</strong>
                  <span>J-{row.jobId}</span>
                </td>
                <td>{prettyLabel(row.transferType)}</td>
                <td>
                  <span className={`status-badge ${row.status}`}>{prettyLabel(row.status)}</span>
                </td>
                <td>{transferProgress(row)}</td>
                <td>{relativeTime(row.completedAtMs || row.startedAtMs || row.queuedAtMs)}</td>
                <td>{remoteSummary(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {transfers && transfers.rows.length === 0 ? <div className="empty">No transfer history found.</div> : null}
      </div>
    </section>
  );
}

function OperationQueueStrip() {
  const { snapshot, working, error, load, cancel, retry, resolveConflict, clearTerminal } = useOperationQueueStore();
  const operations = snapshot?.operations ?? [];
  const active = operations.filter((operation) => operation.status === "queued" || operation.status === "in_progress" || operation.status === "waiting_for_resolution");
  const terminal = operations.length - active.length;
  const conflict = snapshot?.conflictDialog;

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
          <button type="button" disabled={working} onClick={() => void resolveConflict(conflict.operationId, "replace", conflict.applyToBatch)}>
            Replace
          </button>
          <button type="button" disabled={working} onClick={() => void resolveConflict(conflict.operationId, "skip", conflict.applyToBatch)}>
            Skip
          </button>
          {conflict.supportsKeepBoth ? (
            <button type="button" disabled={working} onClick={() => void resolveConflict(conflict.operationId, "keep_both", conflict.applyToBatch)}>
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
