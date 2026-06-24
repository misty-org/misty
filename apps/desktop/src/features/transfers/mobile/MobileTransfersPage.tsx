import { RefreshCcw, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { OperationDescriptor, TransferRecord } from "../../../api/types";
import { useOperationQueueStore } from "../useOperationQueueStore";
import { relativeTime, remoteSummary, transferProgress } from "../transferUtils";
import { useTransfersStore } from "../useTransfersStore";

const emptyOperations: OperationDescriptor[] = [];

export function MobileTransfersPage() {
  const { transfers, working, error, load } = useTransfersStore(useShallow((state) => ({
    transfers: state.transfers,
    working: state.working,
    error: state.error,
    load: state.load,
  })));
  const { operations, queueWorking, cancel, retry } = useOperationQueueStore(useShallow((state) => ({
    operations: state.snapshot?.operations ?? emptyOperations,
    queueWorking: state.working,
    cancel: state.cancel,
    retry: state.retry,
  })));
  const [query, setQuery] = useState("");

  useEffect(() => {
    void load();
    void useOperationQueueStore.getState().load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = transfers?.rows ?? [];
    if (!needle) return source;
    return source.filter((row) =>
      row.fileName.toLowerCase().includes(needle) ||
      row.status.toLowerCase().includes(needle) ||
      remoteSummary(row).toLowerCase().includes(needle),
    );
  }, [query, transfers?.rows]);

  return (
    <section className="mobile-page mobile-transfers-page">
      <div className="mobile-section-header">
        <div>
          <span>Status</span>
          <h2>{transfers?.totalCount ?? 0} transfers</h2>
        </div>
        <button type="button" className="mobile-icon-button" disabled={working} onClick={() => void load()}>
          <RefreshCcw size={18} />
        </button>
      </div>

      <input
        className="mobile-field"
        value={query}
        placeholder="Search transfers"
        onChange={(event) => setQuery(event.target.value)}
      />

      {error ? <div className="mobile-error">{error}</div> : null}

      <div className="mobile-transfer-list" aria-busy={working || queueWorking}>
        {rows.length === 0 ? (
          <div className="mobile-empty-state">
            <h3>No transfers</h3>
            <p>Recent transfer activity will appear here.</p>
          </div>
        ) : rows.map((row) => (
          <MobileTransferCard
            key={row.id}
            row={row}
            operationId={operations.find((operation) => operation.transferId === row.id)?.operationId ?? null}
            onCancel={cancel}
            onRetry={retry}
            disabled={queueWorking}
          />
        ))}
      </div>
    </section>
  );
}

function MobileTransferCard(props: {
  row: TransferRecord;
  operationId: number | null;
  onCancel: (operationId: number) => Promise<void>;
  onRetry: (operationId: number) => Promise<void>;
  disabled: boolean;
}) {
  const completedAt = props.row.completedAtMs || props.row.startedAtMs || props.row.queuedAtMs;
  return (
    <article className={`mobile-transfer-card ${props.row.status}`}>
      <div>
        <strong>{props.row.fileName || "Transfer"}</strong>
        <span>{prettyTransferType(props.row.transferType)} · {remoteSummary(props.row)}</span>
      </div>
      <div className="mobile-transfer-meta">
        <span>{prettyStatus(props.row.status)}</span>
        <span>{transferProgress(props.row)}</span>
        <span>{relativeTime(completedAt)}</span>
      </div>
      {(props.row.cancelable || props.row.retryable) && props.operationId !== null ? (
        <div className="mobile-transfer-actions">
          {props.row.cancelable ? (
            <button type="button" disabled={props.disabled} onClick={() => void props.onCancel(props.operationId!)}>
              <XCircle size={16} /> Cancel
            </button>
          ) : null}
          {props.row.retryable ? (
            <button type="button" disabled={props.disabled} onClick={() => void props.onRetry(props.operationId!)}>
              <RotateCcw size={16} /> Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function prettyTransferType(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function prettyStatus(value: string): string {
  return value.replace(/_/g, " ");
}
