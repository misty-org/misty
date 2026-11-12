// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { parseUsage } from "./usage";

export type UsagePartKind = "input" | "output" | "cacheRead" | "cacheWrite" | "total";

export const USAGE_PART_LABELS: Record<UsagePartKind, string> = {
  input: "Input",
  output: "Output",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
  total: "Tokens",
};

export interface UsageBreakdown {
  /** Tokens held in the context. */
  used: number;
  /** Share of the window, or undefined when the window isn't known. */
  pct?: number;
  parts: { kind: UsagePartKind; tokens: number }[];
}

/** One report's token buckets, and their share of `maxTokens` when that is known. Nothing is
 * assumed about a window the engine didn't report. */
export function usageBreakdown(
  usage: unknown,
  maxTokens: number | undefined,
): UsageBreakdown | null {
  const u = parseUsage(usage);
  if (!u) return null;
  const parts = [
    { kind: "input" as const, tokens: u.input },
    { kind: "output" as const, tokens: u.output },
    { kind: "cacheRead" as const, tokens: u.cacheRead },
    { kind: "cacheWrite" as const, tokens: u.cacheWrite },
  ].filter((p) => p.tokens > 0);
  return {
    used: Math.max(0, u.total),
    // Clamped at 0 too: a malformed report with negative tokens must not give a negative share.
    pct:
      maxTokens && maxTokens > 0
        ? Math.max(0, Math.min(100, Math.round((u.total / maxTokens) * 100)))
        : undefined,
    parts: parts.length ? parts : [{ kind: "total", tokens: u.total }],
  };
}
