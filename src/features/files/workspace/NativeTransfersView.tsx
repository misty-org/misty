import { useCallback, useEffect, useState } from "react";
import type { MistyAppSDK, TransferPage, TransferRecord } from "@misty/sdk";
import { Button } from "@/shared/ui";
import { formatBytes } from "./format";

/** Durable native history stays in its existing database; Files owns its presentation. */
export function NativeTransfersView({ misty, query }: { misty: MistyAppSDK; query: string }) {
  const [page, setPage] = useState<TransferPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => setOffset(0), [query]);
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await misty.fileSystem.transfers({ search: query, offset, limit: 100 });
        if (!closed) {
          setPage(next);
          setError("");
        }
      } catch (cause) {
        if (!closed) setError(String(cause));
      } finally {
        if (!closed) timer = setTimeout(load, 2000);
      }
    };
    void load();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [misty, query, offset, revision]);
  const act = useCallback(async (row: TransferRecord, operation: () => Promise<unknown>) => {
    setBusy(row.id);
    setError("");
    try {
      await operation();
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(null);
    }
  }, []);
  return (
    <section aria-label="Native transfer history">
      <h3 className="px-3 py-2 text-xs text-cream-muted">Device transfers</h3>
      {error && (
        <p role="alert" className="px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {!page && !error && (
        <p role="status" className="p-3 text-sm text-cream-muted">
          Loading transfer history…
        </p>
      )}
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-cream-muted">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th>Progress</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {page?.rows.map((row) => {
            const live = ["queued", "pending", "in_progress", "waiting_for_resolution"].includes(
              row.status,
            );
            return (
              <tr key={row.id} className="border-t border-charcoal-border">
                <td
                  className="max-w-80 truncate px-3 py-2"
                  title={row.localSourcePath || row.remoteSourcePath}
                >
                  {row.queueTitle || row.fileName}
                </td>
                <td>
                  {formatBytes(row.transferredBytes)} / {formatBytes(row.totalBytes)}
                </td>
                <td role="status">
                  {row.errorMessage ||
                    row.detailMessage ||
                    (row.paused ? "Paused" : row.status.replace(/_/g, " "))}
                </td>
                <td className="whitespace-nowrap">
                  {live && row.operationId > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(row, () =>
                          row.paused
                            ? misty.fileSystem.resume(row.operationId)
                            : misty.fileSystem.pause(row.operationId),
                        )
                      }
                    >
                      {row.paused ? "Resume" : "Pause"}
                    </Button>
                  )}
                  {live && row.cancelable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act(row, () => misty.fileSystem.cancel(row.operationId))}
                    >
                      Cancel
                    </Button>
                  )}
                  {!live && row.retryable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void act(row, () => misty.fileSystem.retryTransfer(row.id))}
                    >
                      Retry
                    </Button>
                  )}
                  {!live && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={`Remove ${row.fileName} from device transfer history`}
                      onClick={() =>
                        void act(row, () => misty.fileSystem.deleteTransferHistory([row.id]))
                      }
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {page && !page.rows.length && (
        <p className="p-3 text-sm text-cream-muted">No device transfers.</p>
      )}
      {page && page.totalCount > 100 && (
        <div className="flex items-center gap-2 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!offset}
            onClick={() => setOffset((value) => Math.max(0, value - 100))}
          >
            Previous
          </Button>
          <span className="text-xs text-cream-muted">
            {offset + 1}–{offset + page.rows.length} of {page.totalCount}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={offset + page.rows.length >= page.totalCount}
            onClick={() => setOffset((value) => value + 100)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
