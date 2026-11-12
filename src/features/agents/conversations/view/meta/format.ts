// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { parseUsage } from "./usage";
/** Format turn duration: "12.3s", "2m12s", "1h23m". */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remSec = Math.floor(s % 60);
  if (m < 60) return `${m}m${remSec ? `${remSec}s` : ""}`;
  const h = Math.floor(m / 60);
  const remMin = Math.floor(m % 60);
  return `${h}h${remMin ? `${remMin}m` : ""}`;
}

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

/** One report's tokens as "↑3.2k ↓412". Input is the whole prompt side, fresh tokens plus cache
 * reads and writes, so a cache-heavy turn doesn't read as if it sent almost nothing. */
export function formatUsage(usage: unknown): string | null {
  const u = parseUsage(usage);
  if (!u) return null;
  const input = u.input + u.cacheRead + u.cacheWrite;
  if (!input && !u.output) return null;
  const parts: string[] = [];
  if (input) parts.push(`↑${formatTokens(input)}`);
  if (u.output) parts.push(`↓${formatTokens(u.output)}`);
  return parts.join(" ");
}

/** A model's own name: a provider-qualified slug ("relay vendor/deepseek-v4") shows as the
 * model it names, so no relay leaks into the chat. */
export function modelDisplayName(model: string): string {
  const name = (model ?? "").trim();
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1).trim() : name;
}
