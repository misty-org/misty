import type { OperationQueueSnapshot, TransferRecord } from "@/native/contracts";
import type { TransferType } from "@/native/contracts/primitives";
import { prettyLabel } from "@/shared/lib/format";
import type {
  TransferColumnWidths,
  TransferProgressSnapshot,
  TransferSortableKey,
  TransferTableColumn,
  TransferTreeRow,
} from "./model/page-types/workspace/transferModel";
import type {
  TransferSortDirection,
  TransferSortKey,
} from "./model/stores/transfers/types/useTransfersStore";
import { transferStatusMatchesFilter } from "./store";
export type {
  TransferColumnWidths,
  TransferProgressSnapshot,
  TransferSortableKey,
  TransferTableColumn,
  TransferTreeRow,
} from "./model/page-types/workspace/transferModel";

export const transferTableColumns: TransferTableColumn[] = [
  "transfer",
  "operation",
  "status",
  "time",
  "remote",
  "actions",
];
export const transferColumnLabels: Record<TransferTableColumn, string> = {
  transfer: "Name",
  operation: "Operation",
  status: "Status",
  time: "Time",
  remote: "Remote",
  actions: "Actions",
};
export const transferSortByColumn: Partial<Record<TransferTableColumn, TransferSortableKey>> = {
  transfer: "name",
  operation: "operation",
  status: "status",
  time: "time",
};
export const transferSortOptions: Array<{ key: TransferSortableKey; label: string }> = [
  { key: "time", label: "Time" },
  { key: "name", label: "Name" },
  { key: "operation", label: "Operation" },
  { key: "status", label: "Status" },
];
export const transferDefaultColumnWidths: TransferColumnWidths = {
  transfer: 280,
  operation: 135,
  status: 135,
  time: 130,
  remote: 180,
  actions: 185,
};
export const transferMinimumColumnWidths: TransferColumnWidths = {
  transfer: 190,
  operation: 110,
  status: 110,
  time: 105,
  remote: 140,
  actions: 172,
};

export const TRANSFER_ROW_HEIGHT = 46;
export const TRANSFER_OVERSCAN_ROWS = 8;

export function transferProviderGroups(rows: TransferRecord[], labels: Map<string, string>) {
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

export function filterTransferSearch(rows: TransferRecord[], query: string): TransferRecord[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) =>
    [
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
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export function filterAndSortTransfers(
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
    if (
      filters.providerFilters.size > 0 &&
      !providers.some((provider) => filters.providerFilters.has(provider))
    )
      return false;
    if (filters.locationScope === "local" && providers.length > 0) return false;
    if (filters.locationScope === "remote" && providers.length === 0) return false;
    return true;
  });
  if (filters.sortKey === "none") return filtered;
  const direction = filters.sortDirection === "asc" ? 1 : -1;
  return [...filtered].sort(
    (left, right) =>
      direction * compareTransfers(left, right, filters.sortKey as TransferSortableKey),
  );
}

export function buildTransferTreeRows(
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
      const byName = primaryTransferLabel(left).localeCompare(primaryTransferLabel(right));
      return byName || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
    });
  }
  const result: TransferTreeRow[] = [];
  const pushRow = (row: TransferRecord, depth: number, visited: Set<number>) => {
    const children = childRows.get(row.id) ?? [];
    const expanded = expandedIds.has(row.id);
    result.push({ row, depth, hasChildren: children.length > 0, expanded });
    if (!expanded || visited.has(row.id)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(row.id);
    for (const child of children) pushRow(child, depth + 1, nextVisited);
  };
  for (const row of rows) {
    if (row.parentTransferId && rowsById.has(row.parentTransferId)) continue;
    pushRow(row, 0, new Set());
  }
  return result;
}

export function includeTransferAncestors(
  filteredRows: TransferRecord[],
  allRows: TransferRecord[],
): TransferRecord[] {
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

export function aggregateTransferProgress(
  row: TransferRecord,
  rows: TransferRecord[],
): TransferProgressSnapshot {
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
  if (descendants.length === 0 || (!isTerminalTransfer(row) && row.totalBytes > 0)) {
    const transferredBytes = Math.max(0, row.transferredBytes);
    return {
      transferredBytes,
      totalBytes: Math.max(0, row.totalBytes) || (isTerminalTransfer(row) ? transferredBytes : 0),
      bytesPerSecond: Math.max(0, row.bytesPerSecond || 0),
      aggregated: false,
    };
  }
  return descendants.reduce<TransferProgressSnapshot>(
    (total, descendant) => {
      const transferred = Math.max(0, descendant.transferredBytes);
      return {
        transferredBytes: total.transferredBytes + transferred,
        totalBytes:
          total.totalBytes +
          (Math.max(0, descendant.totalBytes) ||
            (isTerminalTransfer(descendant) ? transferred : 0)),
        bytesPerSecond: total.bytesPerSecond + Math.max(0, descendant.bytesPerSecond || 0),
        aggregated: true,
      };
    },
    { transferredBytes: 0, totalBytes: 0, bytesPerSecond: 0, aggregated: true },
  );
}

export function formatBytes(bytes: number): string {
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

export function primaryTransferLabel(row: TransferRecord): string {
  if (row.fileName) return row.fileName;
  const target = targetEndpoint(row);
  if (target && row.transferType !== "delete") return basename(target);
  return basename(sourceEndpoint(row)) || "Transfer";
}

export function secondaryTransferLabel(row: TransferRecord): string {
  const source = sourceEndpoint(row);
  const target = targetEndpoint(row);
  if (source && target) return `${source} → ${target}`;
  return source || target || "—";
}

export function sourceEndpoint(row: TransferRecord): string {
  if (row.remoteSourceName) return `${row.remoteSourceName}:${row.remoteSourcePath || "/"}`;
  return row.localSourcePath;
}

export function targetEndpoint(row: TransferRecord): string {
  if (row.remoteDestName) return `${row.remoteDestName}:${row.remoteDestPath || "/"}`;
  return row.localDestPath;
}

export function timestampLabel(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "—";
}

export function sortIndicator(
  activeKey: TransferSortKey,
  direction: TransferSortDirection,
  key: TransferSortableKey,
): string {
  if (activeKey !== key) return "";
  return direction === "asc" ? "↑" : "↓";
}

export function transferStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "failed" || status === "canceled" || status === "interrupted") return "Failed";
  if (
    status === "queued" ||
    status === "pending" ||
    status === "in_progress" ||
    status === "waiting_for_resolution"
  )
    return "Pending";
  return prettyLabel(status);
}

export function transferStatusTone(
  status: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "canceled" || status === "interrupted") return "danger";
  if (status === "waiting_for_resolution") return "warning";
  if (status === "queued" || status === "pending" || status === "in_progress") return "info";
  return "neutral";
}

/**
 * Resolves whether a transfer is paused.
 *
 * `TransferRecord.paused` and the operation queue snapshot are refreshed by two
 * independent loads, and queue mutations update the snapshot immediately while
 * the record only catches up on the next transfers poll. The snapshot is
 * therefore the authoritative source whenever it knows about the operation —
 * without this, the pause/resume toggle can read a stale record and send the
 * opposite command.
 */
export function transferPaused(
  transfer: TransferRecord,
  snapshot: OperationQueueSnapshot | null | undefined,
): boolean {
  if (transfer.operationId && snapshot) {
    const operation = snapshot.operations.find(
      (candidate) => candidate.operationId === transfer.operationId,
    );
    if (operation) return operation.paused;
  }
  return transfer.paused;
}

export function canPauseResumeTransfer(transfer: TransferRecord): boolean {
  return (
    Boolean(transfer.operationId) &&
    (transfer.paused ||
      transfer.status === "queued" ||
      transfer.status === "in_progress" ||
      transfer.status === "waiting_for_resolution")
  );
}

export function isLiveTransfer(transfer: TransferRecord): boolean {
  return (
    transfer.status === "queued" ||
    transfer.status === "pending" ||
    transfer.status === "in_progress" ||
    transfer.status === "waiting_for_resolution"
  );
}

export function isBinaryProgressTransfer(row: TransferRecord): boolean {
  return (
    row.transferType === "create" ||
    row.transferType === "archive" ||
    row.transferType === "rename" ||
    row.transferType === "delete"
  );
}

export function binaryProgressStatus(status: TransferRecord["status"]): string {
  if (status === "queued" || status === "pending") return "Queued";
  if (status === "in_progress") return "In progress";
  if (status === "waiting_for_resolution") return "Waiting for resolution";
  if (status === "failed") return "Failed";
  if (status === "canceled") return "Canceled";
  if (status === "skipped") return "Skipped";
  if (status === "interrupted") return "Interrupted";
  return prettyLabel(status);
}

export function transferTime(row: TransferRecord): number {
  return row.completedAtMs || row.startedAtMs || row.queuedAtMs || 0;
}

export function isTransferTableColumn(value: string): value is TransferTableColumn {
  return transferTableColumns.includes(value as TransferTableColumn);
}

function compareTransfers(
  left: TransferRecord,
  right: TransferRecord,
  key: TransferSortableKey,
): number {
  if (key === "name") return primaryTransferLabel(left).localeCompare(primaryTransferLabel(right));
  if (key === "operation") return left.transferType.localeCompare(right.transferType);
  if (key === "status") return left.status.localeCompare(right.status);
  return transferTime(left) - transferTime(right);
}

function transferProviders(row: TransferRecord): string[] {
  return [...new Set([row.remoteSourceName, row.remoteDestName].filter(Boolean))];
}

function basename(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const separator = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const colon = clean.lastIndexOf(":");
  const index = Math.max(separator, colon);
  return index >= 0 ? clean.slice(index + 1) : clean;
}

function isTerminalTransfer(transfer: TransferRecord): boolean {
  return !isLiveTransfer(transfer);
}
