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

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function breadcrumbSegments(path: string): Array<{ label: string; path: string }> {
  if (path === "misty://recent") return [{ label: "Recent", path }];
  if (path === "misty://starred") return [{ label: "Starred", path }];
  if (path === "misty://trash") return [{ label: "Trash", path }];
  const parts = path.split("/").filter(Boolean);
  const segments = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}
