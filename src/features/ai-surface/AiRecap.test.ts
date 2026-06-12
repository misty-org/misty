import { describe, expect, it } from "vitest";
import type { AiRecapRecord } from "./api";
import { isRecapSurface, isUnseenRecap } from "./AiRecap";

function recap(patch: Partial<AiRecapRecord> = {}): AiRecapRecord {
  return {
    surface_id: "home",
    enabled: true,
    cadence: "daily",
    local_time: "08:00",
    weekday: 1,
    timezone: "UTC",
    prompt: "Summarize",
    state: "idle",
    last_result: "A grounded briefing",
    last_citations: [],
    last_run_at: "2026-08-21T15:00:00Z",
    updated_at: "2026-08-21T15:00:00Z",
    ...patch,
  };
}

describe("recurring Misty briefings", () => {
  it("limits background delivery to durable account-level destinations", () => {
    expect(isRecapSurface("home")).toBe(true);
    expect(isRecapSurface("activity")).toBe(true);
    expect(isRecapSurface("global")).toBe(true);
    expect(isRecapSurface("notes")).toBe(false);
  });

  it("nudges only for a completed briefing newer than its seen marker", () => {
    expect(isUnseenRecap(recap())).toBe(true);
    expect(isUnseenRecap(recap({ last_seen_at: "2026-08-21T14:59:59Z" }))).toBe(true);
    expect(isUnseenRecap(recap({ last_seen_at: "2026-08-21T15:00:00Z" }))).toBe(false);
    expect(isUnseenRecap(recap({ last_result: "" }))).toBe(false);
  });
});
