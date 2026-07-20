import { useMemo } from "react";
import { ListFilter, PanelRight } from "lucide-react";
import type { TransferRecord, TransferType } from "../../../api/types";
import { EmptyState } from "@/components/ui/state-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Progress } from "../../../components/ui/progress";
import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { prettyLabel } from "@/shared/format";
import type { TransferSortDirection, TransferSortKey } from "../../../stores/useTransfersStore";
import { transferTypes } from "../../../stores/useTransfersStore";
import { remoteSummary } from "../transferUtils";
import type { TransferActionHandlers } from "./TransferMenus";
import {
  aggregateTransferProgress,
  binaryProgressStatus,
  canPauseResumeTransfer,
  formatBytes,
  isBinaryProgressTransfer,
  primaryTransferLabel,
  sourceEndpoint,
  targetEndpoint,
  timestampLabel,
  transferStatusTone,
  type TransferProgressSnapshot,
} from "./transferModel";
import { transferStyles } from "./transferStyles";

export function TransferFilters(props: {
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
        <div className="flex items-center gap-2">
          <ListFilter aria-hidden="true" className="size-4 text-muted-foreground" />
          <h2 className={transferStyles.filterTitle}>Filters</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={props.activeFilterCount === 0}
          onClick={props.onClear}
        >
          Clear{props.activeFilterCount > 0 ? ` (${props.activeFilterCount})` : ""}
        </Button>
      </div>
      <FilterSection title="Providers">
        {props.providerGroups.length === 0 ? (
          <span className={transferStyles.filterEmpty}>No remote providers</span>
        ) : null}
        <div className={transferStyles.filterOptions}>
          {props.providerGroups.map((group) => (
            <label
              key={group.key}
              className={transferStyles.filterOption}
              htmlFor={`transfer-provider-${group.key}`}
            >
              <Checkbox
                id={`transfer-provider-${group.key}`}
                checked={props.providerFilters.has(group.key)}
                onCheckedChange={() => props.onToggleProvider(group.key)}
              />
              <span className={transferStyles.filterOptionLabel}>{group.label}</span>
              <span className={transferStyles.filterOptionCount}>{group.count}</span>
            </label>
          ))}
        </div>
      </FilterSection>
      <FilterSection title="Transfer type">
        <div className={transferStyles.filterOptions}>
          {transferTypes.map((type) => (
            <label
              key={type}
              className={transferStyles.filterOption}
              htmlFor={`transfer-type-${type}`}
            >
              <Checkbox
                id={`transfer-type-${type}`}
                checked={props.typeFilters.has(type)}
                onCheckedChange={() => props.onToggleType(type)}
              />
              <span className={transferStyles.filterOptionLabel}>{prettyLabel(type)}</span>
              <span aria-hidden="true" />
            </label>
          ))}
        </div>
      </FilterSection>
      <FilterSection title="Location">
        <RadioGroup
          className={transferStyles.filterOptions}
          value={props.locationScope}
          onValueChange={(value) => props.onLocationScope(value as "all" | "local" | "remote")}
        >
          {(["all", "local", "remote"] as const).map((scope) => (
            <label
              key={scope}
              className={transferStyles.filterOption}
              htmlFor={`transfer-location-${scope}`}
            >
              <RadioGroupItem id={`transfer-location-${scope}`} value={scope} />
              <span className={transferStyles.filterOptionLabel}>
                {scope === "all" ? "All" : scope === "local" ? "Local only" : "Remote involved"}
              </span>
              <span aria-hidden="true" />
            </label>
          ))}
        </RadioGroup>
      </FilterSection>
      <FilterSection title="Status">
        <RadioGroup
          className={transferStyles.filterOptions}
          value={props.statusFilter}
          onValueChange={(value) =>
            props.onStatusFilter(value as "all" | "active" | "completed" | "failed")
          }
        >
          {(["all", "active", "completed", "failed"] as const).map((filter) => (
            <label
              key={filter}
              className={transferStyles.filterOption}
              htmlFor={`transfer-status-${filter}`}
            >
              <RadioGroupItem id={`transfer-status-${filter}`} value={filter} />
              <span className={transferStyles.filterOptionLabel}>{prettyLabel(filter)}</span>
              <span aria-hidden="true" />
            </label>
          ))}
        </RadioGroup>
      </FilterSection>
      <FilterSection title="Sort">
        <Select
          value={props.sortKey}
          onValueChange={(value) => {
            const key = value as TransferSortKey;
            props.onSort(key, key === "none" ? undefined : props.sortDirection);
          }}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No sort</SelectItem>
            <SelectItem value="time">Time</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="operation">Operation</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
        <div className={transferStyles.sortDirection}>
          {(["asc", "desc"] as const).map((direction) => (
            <Button
              key={direction}
              variant={
                props.sortKey !== "none" && props.sortDirection === direction
                  ? "secondary"
                  : "outline"
              }
              size="sm"
              disabled={props.sortKey === "none"}
              onClick={() => props.sortKey !== "none" && props.onSort(props.sortKey, direction)}
            >
              {direction === "asc" ? "Ascending" : "Descending"}
            </Button>
          ))}
        </div>
      </FilterSection>
    </div>
  );
}

type DetailHandlers = Pick<
  TransferActionHandlers,
  | "onCancel"
  | "onRetry"
  | "onPauseResume"
  | "onPauseResumeBatch"
  | "onCancelBatch"
  | "onResolveConflict"
>;

export function TransferDetail(
  props: DetailHandlers & {
    transfer: TransferRecord | null;
    rows: TransferRecord[];
    working: boolean;
  },
) {
  const row = props.transfer;
  const progress = useMemo(
    () => (row ? aggregateTransferProgress(row, props.rows) : null),
    [props.rows, row],
  );
  if (!row) {
    return (
      <div className={transferStyles.detailEmpty}>
        <EmptyState
          compact
          icon={<PanelRight />}
          title="No transfer selected"
          description="Select a row to inspect its endpoints, progress, and queue state."
        />
      </div>
    );
  }
  return (
    <div className={transferStyles.detailContent}>
      <header className={transferStyles.detailHeader}>
        <h2 className={transferStyles.detailTitle}>{primaryTransferLabel(row)}</h2>
        <StatusBadge className="capitalize" status={transferStatusTone(row.status)} dot>
          {prettyLabel(row.status)}
        </StatusBadge>
      </header>
      <DetailRow label="Operation" value={prettyLabel(row.transferType)} />
      <DetailRow label="Provider" value={remoteSummary(row)} />
      <DetailRow label="Source" value={sourceEndpoint(row) || "—"} />
      <DetailRow label="Destination" value={targetEndpoint(row) || "—"} />
      <TransferProgressRow row={row} progress={progress} />
      <DetailRow label="Queued" value={timestampLabel(row.queuedAtMs)} />
      <DetailRow label="Started" value={timestampLabel(row.startedAtMs)} />
      <DetailRow label="Completed" value={timestampLabel(row.completedAtMs)} />
      <DetailRow label="Job ID" value={`J-${row.jobId}`} />
      {row.detailMessage ? <DetailRow label="Detail" value={row.detailMessage} /> : null}
      {row.errorMessage ? <DetailRow label="Error" value={row.errorMessage} danger /> : null}
      <DetailActions {...props} row={row} />
    </div>
  );
}

function FilterSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className={transferStyles.filterSection}>
      <h3 className={transferStyles.filterSectionTitle}>{props.title}</h3>
      {props.children}
    </section>
  );
}

function DetailRow(props: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={transferStyles.detailRow}>
      <span className={transferStyles.detailLabel}>{props.label}</span>
      <strong
        className={props.danger ? transferStyles.detailDangerValue : transferStyles.detailValue}
      >
        {props.value}
      </strong>
    </div>
  );
}

function TransferProgressRow(props: {
  row: TransferRecord;
  progress: TransferProgressSnapshot | null;
}) {
  const { row, progress } = props;
  if (isBinaryProgressTransfer(row)) {
    const complete = row.status === "completed";
    const percent = complete ? 100 : 0;
    const primary = complete ? "Complete" : binaryProgressStatus(row.status);
    return (
      <div className={transferStyles.detailRow}>
        <span className={transferStyles.detailLabel}>Progress</span>
        <Progress
          value={percent}
          aria-label="Operation progress"
          aria-valuetext={complete ? "Complete" : `${primary}, not complete`}
        />
        <ProgressMeta
          primary={primary}
          secondary={complete ? "Operation completed" : "Waiting for completion"}
        />
      </div>
    );
  }
  const transferred = Math.max(0, progress?.transferredBytes ?? row.transferredBytes);
  const total = Math.max(0, progress?.totalBytes ?? row.totalBytes);
  const hasTotal = total > 0;
  const percent = hasTotal
    ? Math.min(100, Math.max(0, Math.round((transferred / total) * 100)))
    : undefined;
  const speed = Math.max(0, progress?.bytesPerSecond ?? row.bytesPerSecond ?? 0);
  const secondary = hasTotal
    ? `${formatBytes(transferred)} / ${formatBytes(total)}`
    : `${formatBytes(transferred)} transferred`;
  const tertiary = [
    progress?.aggregated ? "tree total" : "",
    speed > 0 ? `${formatBytes(speed)}/s` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={transferStyles.detailRow}>
      <span className={transferStyles.detailLabel}>Progress</span>
      <Progress
        value={percent}
        aria-label="Transfer progress"
        aria-valuetext={hasTotal ? `${percent}% complete` : secondary}
        className={hasTotal ? undefined : "[&>div]:!translate-x-[-66%]"}
      />
      <ProgressMeta
        primary={hasTotal ? `${percent}%` : "Waiting for total"}
        secondary={tertiary ? `${secondary} · ${tertiary}` : secondary}
      />
    </div>
  );
}

function ProgressMeta(props: { primary: string; secondary: string }) {
  return (
    <div className={transferStyles.progressMeta}>
      <strong className={transferStyles.progressMetaStrong}>{props.primary}</strong>
      <span className="truncate text-right">{props.secondary}</span>
    </div>
  );
}

function DetailActions(props: DetailHandlers & { row: TransferRecord; working: boolean }) {
  const row = props.row;
  return (
    <div className={transferStyles.detailActions}>
      {row.operationId && canPauseResumeTransfer(row) ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={props.working}
          onClick={() => void props.onPauseResume(row)}
        >
          {row.paused ? "Resume" : "Pause"}
        </Button>
      ) : null}
      {row.operationId && row.status === "waiting_for_resolution" ? (
        <>
          {row.supportsReplace ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={props.working}
              onClick={() => void props.onResolveConflict(row, "replace", false)}
            >
              Replace
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={props.working}
            onClick={() => void props.onResolveConflict(row, "skip", false)}
          >
            Skip
          </Button>
          {row.supportsKeepBoth ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={props.working}
              onClick={() => void props.onResolveConflict(row, "keep_both", false)}
            >
              Keep both
            </Button>
          ) : null}
        </>
      ) : null}
      {row.operationId && row.cancelable ? (
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={props.working}
          onClick={() => void props.onCancel(row)}
        >
          Cancel
        </Button>
      ) : null}
      {row.retryable && row.status === "failed" ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={props.working}
          onClick={() => void props.onRetry(row)}
        >
          Retry
        </Button>
      ) : null}
      {row.batchId ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            disabled={props.working}
            onClick={() => void props.onPauseResumeBatch(row)}
          >
            Pause/resume batch
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={props.working}
            onClick={() => void props.onCancelBatch(row)}
          >
            Cancel batch
          </Button>
        </>
      ) : null}
    </div>
  );
}
