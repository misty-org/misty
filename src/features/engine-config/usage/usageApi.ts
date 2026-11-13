// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Usage of the engines on this computer, read from each CLI's own session logs and priced from
 * LiteLLM's public table, and plan limits read through each CLI. Everything stays on this
 * computer; the only request is the optional price-table download. The query shapes follow
 * desktop-cc-gui's usage bridge (features/plugins/runtime/usage-bridge.ts).
 */
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

type UsageBucket = "day" | "hour";

interface UsageQuery {
  /** Local `YYYY-MM-DD`, inclusive. */
  from: string;
  /** Local `YYYY-MM-DD`, inclusive. */
  to: string;
  bucket?: UsageBucket;
}

export interface UsageStatRow {
  /** Local `2026-10-27` (day) or `2026-10-27T14` (hour). */
  bucket: string;
  engine: string;
  model: string;
  /** The folder the session worked in. */
  project: string | null;
  sessions: number;
  requests: number;
  /** Uncached input tokens. */
  input: number;
  /** Output tokens, reasoning included. */
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  /** Estimated USD; null when the model has no known price. */
  cost: number | null;
}

export interface UsageQueryResult {
  rows: UsageStatRow[];
  firstDay: string | null;
  scannedAt: number | null;
  scanning: boolean;
  unknownModels: string[];
}

export interface UsageSource {
  engine: string;
  label: string;
  roots: string[];
  env: string | null;
  files: number;
  status: "ok" | "missing" | "denied" | "error";
  error: string | null;
  lastScanAt: number | null;
}

interface UsageScanSummary {
  filesScanned: number;
  eventsAdded: number;
  durationMs: number;
  scannedAt: number;
}

export interface UsagePriceInfo {
  source: "bundled" | "online";
  snapshotDate: string;
  updatedAt: number | null;
  models: number;
}

export interface LimitWindow {
  id: string;
  kind: "session" | "weekly" | "other";
  label: string | null;
  /** 0 to 100. */
  usedPercent: number;
  windowSeconds: number | null;
  /** Epoch ms. */
  resetsAt: number | null;
  status?: "allowed" | "allowed_warning" | "rejected";
}

export interface LimitCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
}

export type LimitProviderId = "claude" | "codex";

export interface ProviderLimits {
  id: LimitProviderId;
  status: "ok" | "noData" | "notInstalled" | "signedOut" | "offline" | "error";
  plan: string | null;
  windows: LimitWindow[];
  credits: LimitCredits | null;
  usingOverage: boolean | null;
  fetchedAt: number | null;
  error: string | null;
  source: string;
}

interface LimitsResult {
  providers: ProviderLimits[];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_RANGE_DAYS = 3700;

function parseDay(value: string, name: string): Date {
  const match = DATE_RE.exec(value);
  if (!match) throw new Error(`${name} must be a YYYY-MM-DD date`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d, 12);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`${name} is not a real date`);
  }
  return date;
}

/** Minutes east of UTC on the given local day (noon avoids DST edges). */
function tzOffsetForDay(date: Date): number {
  return -date.getTimezoneOffset();
}

/** Local `YYYY-MM-DD` for `date`. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The query as the native side takes it, with the time zone of its last day. */
export function normalizeUsageQuery(query: UsageQuery) {
  const start = parseDay(query.from, "from");
  const end = parseDay(query.to, "to");
  if (start > end) throw new Error("from must not be after to");
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) throw new Error(`the range must not pass ${MAX_RANGE_DAYS} days`);
  return {
    from: query.from,
    to: query.to,
    bucket: query.bucket ?? "day",
    tzOffsetMinutes: tzOffsetForDay(end),
  };
}

export const queryUsage = (query: UsageQuery) =>
  invoke<UsageQueryResult>("engine_usage_query", { query: normalizeUsageQuery(query) });

export const usageSources = () => invoke<UsageSource[]>("engine_usage_sources");

export const rescanUsage = () => invoke<UsageScanSummary>("engine_usage_rescan");

export const usagePrices = () => invoke<UsagePriceInfo>("engine_usage_prices");

export const updateUsagePrices = () => invoke<UsagePriceInfo>("engine_usage_update_prices");

/** Plan limits with reset times, read through each CLI. */
export const usageLimits = (options?: { providers?: LimitProviderId[]; refresh?: boolean }) =>
  invoke<LimitsResult>("engine_usage_limits", {
    providers: options?.providers ?? null,
    refresh: options?.refresh ?? false,
  });

/** Calls `onChange` when a scan added usage, until the returned function is called. */
export function onUsageChanged(onChange: () => void): () => void {
  return subscribe("engine-usage://changed", onChange);
}

/** Native event → callback; the returned function also covers the time before `listen` resolves. */
function subscribe<T>(name: string, callback: (payload: T) => void): () => void {
  if (!hasTauriInternals()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listen<T>(name, (event) => {
    if (!disposed) callback(event.payload);
  })
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => {});
  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}
