/**
 * Formats a byte count the way the quota itself is defined.
 *
 * Plan limits are decimal — the Basic pool is 2,000,000,000 bytes — so dividing
 * by 1024 rendered a full 2 GB pool as "1.86 GB". Decimal units keep the label
 * and the entitlement in agreement, and one decimal is as much precision as a
 * quota line can usefully carry.
 */
export function formatStorageBytes(bytes: number, unitScaleBytes = bytes): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(Math.max(1, unitScaleBytes)) / 3));
  const value = bytes / 1000 ** index;
  if (index === 0) return `${Math.round(value)} B`;
  return `${value.toFixed(1).replace(/\.0$/, "")} ${units[index]}`;
}
