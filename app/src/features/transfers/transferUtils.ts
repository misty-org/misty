import type { TransferRecord } from "@/native/contracts";

export function transferProgress(row: TransferRecord): string {
  if (
    row.transferType === "archive" ||
    row.transferType === "create" ||
    row.transferType === "rename" ||
    row.transferType === "delete"
  ) {
    return row.status === "completed" ? "100%" : "0%";
  }
  if (row.totalBytes <= 0) return "--";
  const percent = Math.min(100, Math.round((row.transferredBytes / row.totalBytes) * 100));
  return `${percent}%`;
}

export function remoteSummary(row: TransferRecord): string {
  const names = [row.remoteSourceName, row.remoteDestName].filter(Boolean);
  return names.length > 0 ? [...new Set(names)].join(" -> ") : "Local";
}

export function relativeTime(timestamp: number): string {
  if (!timestamp) return "--";
  const delta = Date.now() - timestamp;
  const abs = Math.abs(delta);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "just now";
  if (abs < hour) return `${Math.round(abs / minute)}m ago`;
  if (abs < day) return `${Math.round(abs / hour)}h ago`;
  return `${Math.round(abs / day)}d ago`;
}
