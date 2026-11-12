import { describe, expect, it } from "vitest";
import { normalizeUsageQuery, type UsageStatRow } from "./usageApi";
import {
  dailyTotals,
  folderLabel,
  formatCost,
  formatReset,
  formatTokens,
  groupRows,
  windowName,
} from "./usageFormat";

const row = (overrides: Partial<UsageStatRow>): UsageStatRow => ({
  bucket: "2026-11-10",
  engine: "codex",
  model: "gpt-5",
  project: "/work/app",
  sessions: 1,
  requests: 1,
  input: 100,
  output: 10,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  cost: 0.5,
  ...overrides,
});

describe("usage formatting", () => {
  it("shortens token counts", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1234)).toBe("1.2K");
    expect(formatTokens(5_000_000)).toBe("5M");
    expect(formatTokens(250_000)).toBe("250K");
  });

  it("formats cost and marks a lower bound", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(12.345)).toBe("$12.35");
    expect(formatCost(1234.5, true)).toBe("≥ $1,235");
  });

  it("counts down to a reset", () => {
    const now = Date.UTC(2026, 10, 11, 12);
    expect(formatReset(null, now)).toBeNull();
    expect(formatReset(now, now)).toBe("Resets now");
    expect(formatReset(now + 45 * 60_000, now)).toBe("Resets in 45 min");
    expect(formatReset(now + 125 * 60_000, now)).toBe("Resets in 2 h 5 min");
    expect(formatReset(now + (3 * 24 + 4) * 3_600_000, now)).toBe("Resets in 3 d 4 h");
  });

  it("names windows", () => {
    const base = { id: "x", usedPercent: 1, resetsAt: null, windowSeconds: null, label: null };
    expect(windowName({ ...base, kind: "session" })).toBe("5-hour");
    expect(windowName({ ...base, kind: "weekly", label: "Opus" })).toBe("Weekly · Opus");
    expect(windowName({ ...base, kind: "other", windowSeconds: 86_400 })).toBe("24-hour");
  });

  it("groups rows and keeps unpriced ones visible", () => {
    const groups = groupRows(
      [
        row({}),
        row({ engine: "claude", model: "claude-opus", input: 1000, cost: null }),
        row({ bucket: "2026-11-11" }),
      ],
      "engine",
    );
    expect(groups.map((g) => g.key)).toEqual(["claude", "codex"]);
    expect(groups[0].unpriced).toBe(true);
    expect(groups[1].cost).toBeCloseTo(1);
    expect(groups[1].tokens).toBe(220);
  });

  it("fills every day of the range", () => {
    const days = dailyTotals([row({}), row({ bucket: "2026-11-12" })], "2026-11-10", "2026-11-12");
    expect(days.map((d) => d.day)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(days[1].tokens).toBe(0);
    expect(days[2].engines.codex).toBe(110);
  });

  it("labels folders by their last part", () => {
    expect(folderLabel("/Users/me/work/app")).toBe("app");
    expect(folderLabel("C:\\work\\site")).toBe("site");
    expect(folderLabel("")).toBe("No folder");
  });

  it("validates queries and adds the time zone", () => {
    const query = normalizeUsageQuery({ from: "2026-11-01", to: "2026-11-07" });
    expect(query.bucket).toBe("day");
    expect(typeof query.tzOffsetMinutes).toBe("number");
    expect(() => normalizeUsageQuery({ from: "2026-02-30", to: "2026-03-01" })).toThrow();
    expect(() => normalizeUsageQuery({ from: "2026-11-08", to: "2026-11-07" })).toThrow();
  });
});
