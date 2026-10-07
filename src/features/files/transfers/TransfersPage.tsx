import { FileNameIcon } from "@/features/file-ui";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, Info, Pause, Play, Redo2, RotateCcw, Undo2, X } from "lucide-react";
import type { TransferRecord } from "@/native/ipc";
import {
  operationQueueCancel,
  operationQueuePause,
  operationQueuePauseAll,
  operationQueueRedo,
  operationQueueResume,
  operationQueueResumeAll,
  operationQueueRetryTransfer,
  operationQueueUndo,
} from "@/native/transfers-tools";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  CollectionFilters,
  CollectionItems,
  EmptyState,
  IconButton,
  CollectionSkeleton,
  type CollectionColumn,
} from "@/shared/ui";
import { formatBytes, formatDate } from "@/shared/lib/fileFormat";
import {
  isActiveTransfer,
  transferActions,
  transferEndpoints,
  transferSections,
  transferStatus,
  type TransferSection,
} from "./transferModel";
import { transfersPageSize, useTransfers } from "./useTransfers";

/** Inherits the Spaces collection geometry; operational status stays monochrome. */
export function TransfersPage() {
  const [section, setSection] = useState<TransferSection>("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const detailsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (expanded !== null) detailsRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);
  const data = useTransfers(section, search, offset);
  const rows = data.page?.rows ?? [];
  const selected = rows.find((row) => row.id === expanded);
  useEffect(() => {
    if (data.page && offset > 0 && offset >= data.page.totalCount) setOffset(0);
  }, [data.page, offset]);
  const lookup = new Map(rows.map((row) => [String(row.id), row]));
  const operations = new Map(data.queue?.operations.map((op) => [op.operationId, op]));
  const columns: CollectionColumn[] = [
    {
      key: "status",
      label: "Status",
      render: (item) => <TransferProgress row={lookup.get(item.id)!} />,
      sortValue: (item) => transferStatus(lookup.get(item.id)!),
    },
    {
      key: "operation",
      label: "Operation",
      render: (item) => item.category,
      sortValue: (item) => item.category,
    },
    ...(["source", "destination"] as const).map<CollectionColumn>((key) => ({
      key,
      label: key === "source" ? "Source" : "Destination",
      render: (item) => {
        const path = transferEndpoints(lookup.get(item.id)!)[key];
        return (
          <span className="block max-w-56 truncate text-xs" title={path || undefined}>
            {path || "—"}
          </span>
        );
      },
      sortValue: (item) => transferEndpoints(lookup.get(item.id)!)[key],
    })),
    {
      key: "updated",
      label: "Time",
      render: (item) => <span className="text-xs tabular-nums">{item.updated}</span>,
      sortValue: (item) => lookup.get(item.id)!.queuedAtMs,
    },
  ];
  return (
    <CollectionPage>
      <CollectionHeading
        title="Transfers"
        actions={
          <CollectionSearch
            aria-label="Search transfers"
            placeholder="Search transfers"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
        }
      />
      <CollectionFilters
        options={transferSections}
        value={section}
        onChange={(value) => {
          setSection(value as TransferSection);
          setOffset(0);
          setExpanded(null);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={data.working || !data.queue?.redoAvailable}
              onClick={() => void data.run(operationQueueRedo)}
            >
              <Redo2 size={15} />
              Redo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={
                data.working ||
                !data.queue ||
                (!data.queue.paused &&
                  !data.queue.operations.some((op) =>
                    ["queued", "in_progress", "waiting_for_resolution"].includes(op.status),
                  ))
              }
              onClick={() =>
                void data.run(data.queue?.paused ? operationQueueResumeAll : operationQueuePauseAll)
              }
            >
              {data.queue?.paused ? <Play size={15} /> : <Pause size={15} />}
              {data.queue?.paused ? "Resume queue" : "Pause queue"}
            </Button>
          </>
        }
      />
      {data.queue?.paused && (
        <p role="status" className="text-sm text-cream-muted">
          Queue paused. Running transfers can finish; queued transfers will wait.
        </p>
      )}
      {(data.error || data.actionError) && (
        <div role="alert" className="flex items-center gap-3 text-sm text-cream">
          <CircleAlert size={16} />
          <span>{data.actionError || data.error}</span>
          {data.error && (
            <Button variant="ghost" size="sm" onClick={data.refresh}>
              Retry
            </Button>
          )}
        </div>
      )}
      {data.loading ? (
        <CollectionSkeleton label="Loading transfers" />
      ) : rows.length ? (
        <>
          <CollectionItems
            columnSetId="files-transfers"
            stickyActions
            columns={columns}
            sortResetKey={`${section}:${search}:${offset}`}
            items={rows.map((row) => {
              const actions = transferActions(row, operations.get(row.operationId));
              return {
                id: String(row.id),
                title: row.fileName || row.queueTitle || "File operation",
                category: row.transferType.charAt(0).toUpperCase() + row.transferType.slice(1),
                icon: (
                  <FileNameIcon
                    name={
                      row.fileName ||
                      (
                        row.localSourcePath ||
                        row.localDestPath ||
                        row.remoteSourcePath ||
                        row.remoteDestPath
                      )
                        .split(/[\\/]/)
                        .pop() ||
                      ""
                    }
                    size={18}
                  />
                ),
                updated: formatDate(row.completedAtMs || row.startedAtMs || row.queuedAtMs),
                onOpen: () => setExpanded(expanded === row.id ? null : row.id),
                actions: (
                  <div className="flex items-center gap-1">
                    {actions.pause && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={data.working}
                        onClick={() => void data.run(() => operationQueuePause(row.operationId))}
                      >
                        <Pause size={15} />
                        Pause
                      </Button>
                    )}
                    {actions.resume && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={data.working}
                        onClick={() => void data.run(() => operationQueueResume(row.operationId))}
                      >
                        <Play size={15} />
                        Resume
                      </Button>
                    )}
                    {actions.cancel && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={data.working}
                        onClick={() => void data.run(() => operationQueueCancel(row.operationId))}
                      >
                        <X size={15} />
                        Cancel
                      </Button>
                    )}
                    {actions.retry && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={data.working}
                        onClick={() => void data.run(() => operationQueueRetryTransfer(row.id))}
                      >
                        <RotateCcw size={15} />
                        Retry
                      </Button>
                    )}
                    {actions.undo && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={data.working}
                        onClick={() => void data.run(() => operationQueueUndo(row.undoTokenId))}
                      >
                        <Undo2 size={15} />
                        Undo {row.transferType}
                      </Button>
                    )}
                    <IconButton
                      label={`View details for ${row.fileName || "transfer"}`}
                      onClick={() => setExpanded(row.id)}
                    >
                      <Info size={16} />
                    </IconButton>
                  </div>
                ),
              };
            })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-cream-muted">
            <span>
              {offset + 1}–{offset + rows.length} of {data.page?.totalCount} transfers
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - transfersPageSize))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + rows.length >= (data.page?.totalCount ?? 0)}
                onClick={() => setOffset(offset + transfersPageSize)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : (
        !data.error && (
          <EmptyState
            title={
              search
                ? "No matching transfers"
                : section === "active"
                  ? "No active transfers"
                  : section === "failed"
                    ? "No failed transfers"
                    : section === "completed"
                      ? "No completed transfers"
                      : "No transfers yet"
            }
            description={
              search
                ? "Try another filename or path."
                : "File operations appear here when you copy, move, or change files in Files."
            }
          />
        )
      )}
      {selected && (
        <section
          ref={detailsRef}
          aria-label="Transfer details"
          className="border-t border-charcoal-border pt-4 text-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 break-all font-medium">
              {selected.fileName || selected.queueTitle}
            </h2>
            <IconButton label="Close transfer details" onClick={() => setExpanded(null)}>
              <X size={16} />
            </IconButton>
          </div>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {Object.entries({
              Status: transferStatus(selected),
              Source: transferEndpoints(selected).source || "—",
              Destination: transferEndpoints(selected).destination || "—",
              Size: formatBytes(selected.totalBytes),
              ...(isActiveTransfer(selected)
                ? { Transferred: formatBytes(selected.transferredBytes) }
                : {}),
              ...(selected.status === "in_progress" &&
              !selected.paused &&
              selected.bytesPerSecond > 0
                ? { Speed: `${formatBytes(selected.bytesPerSecond)}/s` }
                : {}),
              Started: selected.startedAtMs ? formatDate(selected.startedAtMs) : "Not started",
              Finished: selected.completedAtMs ? formatDate(selected.completedAtMs) : "—",
            }).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-cream-muted">{label}</dt>
                <dd className="mt-1 break-all">{value}</dd>
              </div>
            ))}
          </dl>
          {selected.errorMessage && (
            <p className="mt-3 whitespace-pre-wrap break-words">
              <CircleAlert size={15} className="mr-2 inline" />
              {selected.errorMessage}
            </p>
          )}
          {selected.detailMessage && (
            <p className="mt-3 break-words text-cream-muted">{selected.detailMessage}</p>
          )}
          {selected.paused && (
            <p className="mt-3 text-cream-muted">
              Resuming a paused local copy restarts that file.
            </p>
          )}
        </section>
      )}
    </CollectionPage>
  );
}

function TransferProgress({ row }: { row: TransferRecord }) {
  const running = row.status === "in_progress" && !row.paused;
  if (!running || row.totalBytes <= 0) {
    return <span className="text-xs">{transferStatus(row)}</span>;
  }
  const percent = Math.min(
    100,
    Math.max(0, Math.round((row.transferredBytes / row.totalBytes) * 100)),
  );
  return (
    <div className="flex w-32 items-center gap-3" title={`Transferring · ${percent}%`}>
      <div
        role="progressbar"
        aria-label={`${row.fileName} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`Transferring, ${percent}%`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-charcoal-border"
      >
        <div className="h-full rounded-full bg-cream-muted" style={{ width: `${percent}%` }} />
      </div>
      <span aria-hidden="true" className="w-9 shrink-0 text-right text-xs tabular-nums text-cream">
        {percent}%
      </span>
    </div>
  );
}
