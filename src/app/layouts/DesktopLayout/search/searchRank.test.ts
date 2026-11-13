import { describe, expect, it } from "vitest";
import { excerpt, fieldScore, fold, markParts, matchScore, rank, within } from "./searchRank";

describe("search matching", () => {
  it("needs every word", () => {
    expect(matchScore("Weekly planning notes", "planning notes")).toBeGreaterThan(0);
    expect(matchScore("Weekly planning notes", "planning budget")).toBe(0);
  });

  it("ranks a start over a word over a part of one", () => {
    const start = matchScore("Calendar", "cal");
    const word = matchScore("My cal", "cal");
    const part = matchScore("Recall", "cal");
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(part);
  });

  it("forgives a slip in longer words only", () => {
    expect(matchScore("Calendar", "calender")).toBeGreaterThan(0);
    expect(matchScore("Integrations", "intgrations")).toBeGreaterThan(0);
    expect(matchScore("Cat", "car")).toBe(0);
  });

  it("ignores case and accents", () => {
    expect(fold("Café")).toBe("cafe");
    expect(matchScore("Café menu", "cafe")).toBeGreaterThan(0);
  });

  it("counts a body match less than a title match", () => {
    expect(fieldScore("budget", "Budget")).toBeGreaterThan(
      fieldScore("budget", "Q3", "the budget"),
    );
  });

  it("measures edits with swaps", () => {
    expect(within("teh", "the", 1)).toBe(true);
    expect(within("abcd", "wxyz", 2)).toBe(false);
  });
});

describe("search marking", () => {
  it("marks every match", () => {
    expect(markParts("Plan the plan", "plan")).toEqual([
      { text: "Plan", marked: true },
      { text: " the ", marked: false },
      { text: "plan", marked: true },
    ]);
  });

  it("cuts an excerpt around the first match", () => {
    const text = `${"word ".repeat(60)}needle ${"tail ".repeat(60)}`;
    const parts = excerpt(text, "needle", 60);
    expect(parts.some((part) => part.marked && part.text === "needle")).toBe(true);
    expect(parts[0].text.startsWith("…")).toBe(true);
  });
});

describe("search order", () => {
  it("adds recency and use to the match", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    const fresh = rank({ match: 6, updatedAt: "2026-11-11T10:00:00Z", now });
    const stale = rank({ match: 6, updatedAt: "2025-01-01T00:00:00Z", now });
    expect(fresh).toBeGreaterThan(stale);
    expect(rank({ match: 6, uses: 8, now })).toBeGreaterThan(rank({ match: 6, now }));
  });
});
