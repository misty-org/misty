// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { describe, expect, it } from "vitest";
import { parseUsage, reportedContextWindow } from "./usage";
import { usageBreakdown } from "./usageBreakdown";

describe("parseUsage", () => {
  it("recognizes 1M metadata before tokens arrive and rejects invalid capacities", () => {
    expect(reportedContextWindow({ contextWindow: "1M" })).toBe(1_000_000);
    for (const value of [0, -1, Infinity, "-1M", "unknown"]) {
      expect(reportedContextWindow({ model_context_window: value })).toBeUndefined();
    }
  });
  it.each([1_000_000, "1M", "1000000"])(
    "recognizes a %s context window from token_count info",
    (window) => {
      const parsed = parseUsage({
        info: {
          model_context_window: window,
          last_token_usage: { input_tokens: 89000, output_tokens: 1000 },
          total_token_usage: { input_tokens: 2000000, output_tokens: 50000 },
        },
      });
      expect(parsed?.contextWindow).toBe(1_000_000);
      expect(parsed?.total).toBe(90000);
      expect(usageBreakdown({ input_tokens: 90000 }, parsed!.contextWindow!)?.pct).toBe(9);
    },
  );

  it("folds a codex record's cache counters out of its input", () => {
    // The session-log tail emits token_usage_record payloads: a flat usage
    // with codex's own cache field names and the stamped context window.
    // Codex bills `input_tokens` as the whole prompt and reports
    // `total_tokens` = input + output, so the cache counters are already
    // inside input and must not be added again.
    const parsed = parseUsage({
      input_tokens: 8000,
      cached_input_tokens: 6000,
      cache_write_input_tokens: 1500,
      output_tokens: 300,
      total_tokens: 8300,
      model_context_window: 258_400,
    });
    expect(parsed).toMatchObject({
      input: 500,
      output: 300,
      cacheRead: 6000,
      cacheWrite: 1500,
      total: 8300,
      contextWindow: 258_400,
    });
    expect(parsed!.input + parsed!.output + parsed!.cacheRead + parsed!.cacheWrite).toBe(
      parsed!.total,
    );
  });

  it("keeps claude's cache tokens outside its input", () => {
    // Claude reports fresh input separately from the cache it read and wrote,
    // so there the cache volume is missing input rather than a subset of it.
    const parsed = parseUsage({
      input_tokens: 400,
      cache_read_input_tokens: 6000,
      cache_creation_input_tokens: 1500,
      output_tokens: 300,
    });
    expect(parsed).toMatchObject({
      input: 400,
      output: 300,
      cacheRead: 6000,
      cacheWrite: 1500,
      total: 8200,
    });
  });

  it("reads DSH's camelCase counters as disjoint buckets", () => {
    // DSH reports TokenUsage in camelCase, and its counts are disjoint:
    // inputTokens is uncached input only, cache read/write are separate (billed
    // input = the three summed). Without these aliases all four buckets read 0
    // — only totalTokens survived — so the breakdown collapsed to a single
    // total row, per-message readouts vanished, and the ledger dropped the row
    // outright (usage_record skips a report whose four buckets sum to zero).
    const parsed = parseUsage({
      inputTokens: 1000,
      outputTokens: 50,
      cacheReadTokens: 200,
      cacheWriteTokens: 10,
      totalTokens: 1260,
    });
    expect(parsed).toMatchObject({
      input: 1000,
      output: 50,
      cacheRead: 200,
      cacheWrite: 10,
      total: 1260,
    });
    // Disjoint like claude: the cache volume must stay outside input (the
    // codex-only `cached_input_tokens` heuristic must not fire here).
    expect(parsed!.input + parsed!.output + parsed!.cacheRead + parsed!.cacheWrite).toBe(
      parsed!.total,
    );
    // Every bucket survives the breakdown, so the stacked bar keeps its four
    // segments instead of falling back to the single total row.
    expect(
      usageBreakdown(
        {
          inputTokens: 1000,
          outputTokens: 50,
          cacheReadTokens: 200,
          cacheWriteTokens: 10,
          totalTokens: 1260,
        },
        100_000,
      )?.parts.map((p) => p.kind),
    ).toEqual(["input", "output", "cacheRead", "cacheWrite"]);
  });

  it("reads a flattened last-turn snapshot with the window copied on", () => {
    const parsed = parseUsage({
      input_tokens: 34_660,
      output_tokens: 85,
      total_tokens: 34_745,
      model_context_window: 475_000,
    });
    expect(parsed?.contextWindow).toBe(475_000);
    expect(parsed?.total).toBe(34_745);
  });
});

describe("mergeUsage", () => {
  describe("usageBreakdown", () => {
    it("returns null when usage cannot be parsed", () => {
      expect(usageBreakdown(null, 200000)).toBeNull();
    });

    it("computes pct against the provided maxTokens", () => {
      const breakdown = usageBreakdown(
        { input_tokens: 10000, output_tokens: 2000, total_tokens: 12000 },
        200000,
      );
      expect(breakdown).not.toBeNull();
      expect(breakdown?.pct).toBe(6);
      // The parts add up to the total (10000 + 2000 = 12000).
      const sumSegments = breakdown?.parts.reduce((sum, p) => sum + p.tokens, 0);
      expect(sumSegments).toBe(12000);
    });

    it("leaves the share unknown when no window was reported", () => {
      const breakdown = usageBreakdown({ input: 900, output: 100, used: 1000 }, undefined);
      expect(breakdown?.pct).toBeUndefined();
      expect(breakdown?.used).toBe(1000);
    });

    it("reads the usage.updated event's own fields", () => {
      const breakdown = usageBreakdown(
        { input: 400, output: 100, cacheRead: 500, cacheWrite: 0, used: 1000, window: 10_000 },
        10_000,
      );
      expect(breakdown?.pct).toBe(10);
      expect(breakdown?.parts.map((p) => p.kind)).toEqual(["input", "output", "cacheRead"]);
    });

    it("clamps pct at zero for negative token counts", () => {
      const breakdown = usageBreakdown(
        { input_tokens: -5000, output_tokens: 0, total_tokens: -5000 },
        200000,
      );
      expect(breakdown?.pct).toBe(0);
    });
  });
});
