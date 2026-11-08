import { describe, expect, it } from "vitest";
import type { MemoryEvent } from "@/features/memory/recall";
import { dayBounds, leftOffPage, siteThreads, threadTime } from "./recapDay";

const event = (at: string, site?: string, url?: string) =>
  ({
    occurred_at: new Date(
      2026,
      10,
      5,
      ...(at.split(":").map(Number) as [number, number]),
    ).toISOString(),
    site,
    url,
  }) as MemoryEvent;

describe("recap day", () => {
  it("spans one local day", () => {
    const { from, to } = dayBounds("2026-11-05");
    expect(new Date(from).getDate()).toBe(5);
    expect(new Date(to).getDate()).toBe(6);
  });

  it("leaves off at the newest moment with an address", () => {
    const voice = event("15:00");
    const page = event("14:00", "github.com", "https://github.com/a");
    expect(leftOffPage([voice, page, event("09:00", "b.com", "https://b.com")])).toBe(page);
    expect(leftOffPage([voice])).toBeUndefined();
  });

  it("falls back to sites, busiest first, with when each started and stopped", () => {
    expect(
      siteThreads([
        event("15:00", "a.com"),
        event("14:00", "b.com"),
        event("13:00", "b.com"),
        event("12:00"),
      ]),
    ).toEqual([
      { title: "b.com", from: "13:00", to: "14:00" },
      { title: "a.com", from: "15:00", to: "15:00" },
    ]);
  });

  it("shows one time when a thread didn't span any", () => {
    expect(threadTime({ from: "09:10", to: "09:10" })).not.toContain(" to ");
    expect(threadTime({ from: "09:10", to: "10:25" })).toContain(" to ");
  });
});
