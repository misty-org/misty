import { expect, it } from "vitest";
import { chatUsage, formatCost } from "./chatUsage";

it("adds up a chat's replies and keeps the latest one's context", () => {
  const usage = chatUsage([
    { input: 100, cacheRead: 900, output: 50, used: 1050, window: 200_000, costUsd: 0.02 },
    undefined,
    { input: 20, cacheRead: 1000, cacheWrite: 80, output: 30, reasoning: 10, used: 1130 },
  ]);
  expect(usage).toMatchObject({
    replies: 2,
    totalIn: 2100,
    totalOut: 80,
    used: 1130,
    window: 200_000,
    costUsd: 0.02,
  });
  expect(usage.last?.reasoning).toBe(10);
  expect(usage.cacheHit).toBeCloseTo(1000 / 1100);
});

it("has no cost when no reply reported one", () => {
  expect(chatUsage([{ input: 5, output: 5 }]).costUsd).toBeUndefined();
  expect(formatCost(0.004)).toBe("<$0.01");
  expect(formatCost(1.236)).toBe("$1.24");
});

it("clears the context count after a compaction that reported none", () => {
  const usage = chatUsage([
    { input: 580, cacheRead: 5504, output: 165, used: 6249, window: 200_000 },
    { input: 580, cacheRead: 5504, output: 165, used: 0, window: 200_000 },
  ]);
  expect(usage.used).toBeUndefined();
  expect(usage.totalIn).toBe(12_168);
  expect(chatUsage([{ used: 6249 }, { used: 0 }, { input: 9, output: 1, used: 10 }]).used).toBe(10);
});
