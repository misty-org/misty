import { describe, expect, it } from "vitest";
import { earlyGiveUp, mayRefuseGiveUp } from "../src/persistence-check.js";

const partial = (requirement: string, reason: string) => ({ outcome: "partial" as const, summary: "Some of it.", remaining: [{ requirement, reason }] });

describe("earlyGiveUp", () => {
  it("sends an early partial finish back to work", () => {
    expect(earlyGiveUp(partial("Tecovas boot options", "the search page returned an error"), 6, 120)).toContain("Tecovas boot options");
  });

  it("lets a finish stand when it is complete, late, or blocked on the person", () => {
    expect(earlyGiveUp({ outcome: "completed", summary: "Done.", remaining: [] }, 3, 120)).toBeUndefined();
    expect(earlyGiveUp(partial("Tecovas boot options", "the page failed"), 70, 120)).toContain("Tecovas boot options");
    expect(earlyGiveUp(partial("Tecovas boot options", "the page failed"), 111, 120)).toBeUndefined();
    expect(earlyGiveUp(partial("Order history", "needs the person to sign in"), 3, 120)).toBeUndefined();
  });
});

describe("give-ups inside the run's own estimate", () => {
  it("sends back more than three while the run is well inside its estimate", () => {
    expect(mayRefuseGiveUp(2, 30 * 60_000, undefined)).toBe(true);
    expect(mayRefuseGiveUp(3, 8 * 60_000, 45)).toBe(true);
    expect(mayRefuseGiveUp(3, 40 * 60_000, 45)).toBe(false);
    expect(mayRefuseGiveUp(3, 8 * 60_000, undefined)).toBe(false);
    expect(mayRefuseGiveUp(8, 1 * 60_000, 45)).toBe(false);
  });
});
