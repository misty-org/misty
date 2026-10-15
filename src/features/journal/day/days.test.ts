import { describe, expect, it } from "vitest";
import { dayBounds, dayLabel, shiftDay } from "./days";

describe("journal days", () => {
  it("moves across month and year ends", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("spans exactly one local day", () => {
    const { from, to } = dayBounds("2026-10-14");
    expect(new Date(from).getDate()).toBe(14);
    expect(new Date(to).getDate()).toBe(15);
    expect(new Date(from).getHours()).toBe(0);
  });

  it("names today and yesterday", () => {
    expect(dayLabel("2026-10-14", "2026-10-14")).toBe("Today");
    expect(dayLabel("2026-10-13", "2026-10-14")).toBe("Yesterday");
  });
});
