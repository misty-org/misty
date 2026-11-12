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
