// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
interface ParsedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  contextWindow?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function num(u: Record<string, unknown>, k: string): number {
  return typeof u[k] === "number" ? (u[k] as number) : 0;
}

function reportedWindow(...sources: Array<Record<string, unknown> | null>): number | undefined {
  for (const source of sources) {
    for (const key of ["model_context_window", "context_window", "contextWindow", "window"]) {
      const raw = source?.[key];
      const match =
        typeof raw === "string" ? raw.trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM]?)$/) : null;
      const n =
        typeof raw === "number"
          ? raw
          : match
            ? Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1)
            : 0;
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

export function reportedContextWindow(usage: unknown): number | undefined {
  const raw = asRecord(usage);
  const info = asRecord(raw?.info);
  return reportedWindow(
    raw,
    info,
    asRecord(raw?.last_token_usage),
    asRecord(info?.last_token_usage),
  );
}

function cacheInsideInput(u: Record<string, unknown>): boolean {
  return typeof u.cached_input_tokens === "number";
}

export function parseUsage(usage: unknown): ParsedUsage | null {
  const raw = asRecord(usage);
  if (!raw) return null;
  const info = asRecord(raw.info) ?? raw;
  const nested = asRecord(info.last_token_usage);
  const u = nested ?? info;
  const reportedInput = num(u, "input_tokens") || num(u, "input") || num(u, "inputTokens");
  const output = num(u, "output_tokens") || num(u, "output") || num(u, "outputTokens");
  const cacheRead =
    num(u, "cache_read_input_tokens") ||
    num(u, "cacheRead") ||
    num(u, "cached_input_tokens") ||
    num(u, "cacheReadTokens");
  const cacheWrite =
    num(u, "cache_creation_input_tokens") ||
    num(u, "cacheWrite") ||
    num(u, "cache_write_input_tokens") ||
    num(u, "cacheWriteTokens");
  const input = cacheInsideInput(u)
    ? Math.max(0, reportedInput - cacheRead - cacheWrite)
    : reportedInput;
  const total =
    num(u, "total_tokens") ||
    num(u, "totalTokens") ||
    num(u, "used") ||
    input + output + cacheRead + cacheWrite;
  if (!total) return null;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    contextWindow: reportedContextWindow(raw),
  };
}
