import { isWindowsExplorerPath, normalizeExplorerPath } from "./pathNormalization";

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatDate(timestamp: number | string | null | undefined): string {
  if (timestamp == null) return "-";
  const date = typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp.trim());
  if (Number.isNaN(date.getTime()))
    return typeof timestamp === "string" && timestamp.trim() ? timestamp : "-";
  const hours = date.getHours();
  const hour = hours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ${hour}:${minutes} ${period}`;
}

export function breadcrumbSegments(path: string): Array<{ label: string; path: string }> {
  if (path === "misty://recent") return [{ label: "Recent", path }];
  if (path === "misty://starred") return [{ label: "Starred", path }];
  if (path === "misty://trash") return [{ label: "Trash", path }];
  const normalized = normalizeExplorerPath(path);
  const parts = normalized.split("/").filter(Boolean);
  if (isWindowsExplorerPath(normalized) && /^[A-Za-z]:$/.test(parts[0] ?? "")) {
    const [drive, ...children] = parts;
    const segments = [{ label: drive, path: `${drive}/` }];
    let current = `${drive}/`;
    for (const part of children) {
      current = `${current.replace(/\/+$/, "")}/${part}`;
      segments.push({ label: part, path: current });
    }
    return segments;
  }
  const segments = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}
