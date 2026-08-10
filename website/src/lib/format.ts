/** Human-readable byte size using decimal units, e.g. "1.5 GB". */
export function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, bytes);
  if (safeBytes < 1_000) return `${safeBytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(safeBytes) / Math.log(1_000)) - 1,
  );
  const value = safeBytes / 1_000 ** (unitIndex + 1);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

/** Turns an API status slug such as "past_due" into "Past Due". */
export function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character: string) => character.toUpperCase());
}

/** First letter of the first two words, uppercased — for avatar fallbacks. */
export function toInitials(value: string): string {
  return value
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
