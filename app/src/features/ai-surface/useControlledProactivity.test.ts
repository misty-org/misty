import { describe, expect, it } from "vitest";
import { proactivePreferenceCanShow, proactiveSuggestionReason } from "./useControlledProactivity";

describe("controlled Misty proactivity", () => {
  const now = Date.parse("2026-08-26T18:00:00Z");

  it("requires both the master switch and the per-surface opt-in", () => {
    const preference = {
      proactive_enabled: true,
      proactive_cooldown_minutes: 360,
    };
    expect(proactivePreferenceCanShow({ enabled: true }, preference, now)).toBe(true);
    expect(proactivePreferenceCanShow({ enabled: false }, preference, now)).toBe(false);
    expect(
      proactivePreferenceCanShow(
        { enabled: true },
        { ...preference, proactive_enabled: false },
        now,
      ),
    ).toBe(false);
  });

  it("honors durable snooze and cooldown timestamps", () => {
    const preference = {
      proactive_enabled: true,
      proactive_cooldown_minutes: 360,
      proactive_snoozed_until: "2026-08-27T18:00:00Z",
      proactive_last_shown_at: undefined,
    };
    expect(proactivePreferenceCanShow({ enabled: true }, preference, now)).toBe(false);
    expect(
      proactivePreferenceCanShow(
        { enabled: true },
        {
          ...preference,
          proactive_snoozed_until: undefined,
          proactive_last_shown_at: "2026-08-26T16:00:00Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      proactivePreferenceCanShow(
        { enabled: true },
        {
          ...preference,
          proactive_snoozed_until: undefined,
          proactive_last_shown_at: "2026-08-26T10:00:00Z",
        },
        now,
      ),
    ).toBe(true);
  });

  it("explains why the suggestion appeared and that review is required", () => {
    expect(proactiveSuggestionReason("inbox")).toBe(
      "Because you enabled suggestions for Inbox. Nothing starts until you review it.",
    );
  });
});
