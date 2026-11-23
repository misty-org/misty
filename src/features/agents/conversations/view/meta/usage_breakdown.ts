// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { parseUsage } from "./usage";

type UsagePartKind = "input" | "output" | "cacheRead" | "cacheWrite" | "total";

export const USAGE_PART_LABELS: Record<UsagePartKind, string> = {
  input: "Input",
  output: "Output",
  cacheRead: "Cache read",
  cacheWrite: "Cache write",
  total: "Tokens",
};

interface UsageBreakdown {
  used: number;
  pct?: number;
  parts: { kind: UsagePartKind; tokens: number }[];
}

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
    pct:
      maxTokens && maxTokens > 0
        ? Math.max(0, Math.min(100, Math.round((u.total / maxTokens) * 100)))
        : undefined,
    parts: parts.length ? parts : [{ kind: "total", tokens: u.total }],
  };
}
