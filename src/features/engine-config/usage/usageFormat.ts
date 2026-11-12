// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import type { LimitWindow, ProviderLimits, UsageStatRow } from "./usageApi";

/** `1234` → "1.2K", `5_600_000` → "5.6M". */
export function formatTokens(count: number): string {
  const abs = Math.abs(count);
  if (abs < 1000) return String(Math.round(count));
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, unit] of units) {
    if (abs >= size) {
      const value = count / size;
      return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, "")}${unit}`;
    }
  }
  return String(count);
}

/** Dollars, with cents under $100 and "<$0.01" for a cost too small to show. */
export function formatCost(cost: number, lowerBound = false): string {
  const prefix = lowerBound ? "≥ " : "";
  if (cost > 0 && cost < 0.01) return `${prefix}<$0.01`;
  const text = cost >= 100 ? `$${Math.round(cost).toLocaleString("en-US")}` : `$${cost.toFixed(2)}`;
  return `${prefix}${text}`;
}

/** "in 2 h 5 min", "in 3 d 4 h", "now" for a reset time in epoch ms. */
export function formatReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null;
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  if (minutes === 0) return "Resets now";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `Resets in ${days} d${hours ? ` ${hours} h` : ""}`;
  if (hours > 0) return `Resets in ${hours} h${rest ? ` ${rest} min` : ""}`;
  return `Resets in ${rest} min`;
}

/** The name a window is shown under. */
export function windowName(window: LimitWindow): string {
  const base =
    window.kind === "session"
      ? "5-hour"
      : window.kind === "weekly"
        ? "Weekly"
        : window.windowSeconds
          ? `${Math.round(window.windowSeconds / 3600)}-hour`
          : "Other";
  return window.label ? `${base} · ${window.label}` : base;
}

export const engineNames: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "Pi",
  omp: "Oh My Pi",
};

export const engineName = (engine: string) => engineNames[engine] ?? engine;

/** Why a provider shows no limits, in a few words. */
export function limitsStatusText(limits: ProviderLimits): string | null {
  switch (limits.status) {
    case "ok":
      return null;
    case "noData":
      return limits.id === "claude" ? "Shown after Claude Code's next run" : "Not read yet";
    case "notInstalled":
      return "Codex isn't installed";
    case "signedOut":
      return "Sign in to the CLI with a plan to see limits";
    case "offline":
      return "Offline, showing the last limits seen";
    case "error":
      return limits.error ?? "Couldn't read the limits";
  }
}

export type UsageGroup = "engine" | "model" | "project";

export interface GroupTotals {
  key: string;
  requests: number;
  tokens: number;
  input: number;
  output: number;
  cache: number;
  cost: number;
  unpriced: boolean;
}

const tokensOf = (row: UsageStatRow) => row.input + row.output + row.cacheRead + row.cacheWrite;

/** Rows summed by engine, model or folder, most tokens first. */
export function groupRows(rows: UsageStatRow[], group: UsageGroup): GroupTotals[] {
  const groups = new Map<string, GroupTotals>();
  for (const row of rows) {
    const key =
      group === "engine" ? row.engine : group === "model" ? row.model : (row.project ?? "");
    const entry = groups.get(key) ?? {
      key,
      requests: 0,
      tokens: 0,
      input: 0,
      output: 0,
      cache: 0,
      cost: 0,
      unpriced: false,
    };
    entry.requests += row.requests;
    entry.tokens += tokensOf(row);
    entry.input += row.input;
    entry.output += row.output;
    entry.cache += row.cacheRead + row.cacheWrite;
    if (row.cost === null) entry.unpriced = true;
    else entry.cost += row.cost;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
}

export interface DayTotals {
  day: string;
  tokens: number;
  cost: number;
  /** Tokens by engine, for the stacked bar. */
  engines: Record<string, number>;
}

/** One entry per day from `from` to `to`, days without usage included. */
export function dailyTotals(rows: UsageStatRow[], from: string, to: string): DayTotals[] {
  const byDay = new Map<string, DayTotals>();
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    byDay.set(key, { day: key, tokens: 0, cost: 0, engines: {} });
  }
  for (const row of rows) {
    const entry = byDay.get(row.bucket.slice(0, 10));
    if (!entry) continue;
    const tokens = tokensOf(row);
    entry.tokens += tokens;
    entry.cost += row.cost ?? 0;
    entry.engines[row.engine] = (entry.engines[row.engine] ?? 0) + tokens;
  }
  return [...byDay.values()];
}

/** The last part of a folder path, for a compact label. */
export function folderLabel(path: string): string {
  if (!path) return "No folder";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
