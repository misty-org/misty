// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
const UNITS = [
  { scale: 1, suffix: "" },
  { scale: 1_000, suffix: "k" },
  { scale: 1_000_000, suffix: "M" },
  { scale: 1_000_000_000, suffix: "B" },
  { scale: 1_000_000_000_000, suffix: "T" },
];

const CARRY_AT = 999.95;

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
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}${suffix}`;
}

export function tookText(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}
