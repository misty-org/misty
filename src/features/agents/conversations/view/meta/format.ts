// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
const UNITS = [
  { scale: 1, suffix: "" },
  { scale: 1_000, suffix: "k" },
  { scale: 1_000_000, suffix: "M" },
  { scale: 1_000_000_000, suffix: "B" },
  { scale: 1_000_000_000_000, suffix: "T" },
];

/** One decimal rounds 999.95 up to "1000.0", which is the next unit's job. */
const CARRY_AT = 999.95;

/** Compact token counts for a dense row of numbers: 314 is "314", 96,000 "96k", 482,800
 * "482.8k", 1,000,000 "1M". The ladder runs to T so no magnitude prints 1000 of the unit below. */
export function formatTokens(n: number): string {
  let unit = 0;
  while (unit + 1 < UNITS.length && n >= UNITS[unit + 1].scale) unit++;
  let value = n / UNITS[unit].scale;
  if (value >= CARRY_AT && unit + 1 < UNITS.length) {
    unit++;
    value = n / UNITS[unit].scale;
  }
  const { suffix } = UNITS[unit];
  if (!suffix) return String(n);
  // Round first, then decide: 999_999 carries to 0.999999B-style values that
  // are integral only after rounding, and "1.0M" is not how the other rows read.
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}${suffix}`;
}

/** How long a run took, the way a reply's facts say it: "8s", "2m 5s", "1h 3m". */
export function tookText(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}
