import { describe, expect, it } from "vitest";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { agendaEntryDayKey, groupAgendaEntries } from "./agendaDates";

function allDayEntry(startsAt: string, timezone: string): SpaceAgendaEntry {
  return {
    all_day: true,
    ends_at: "2026-08-06T00:00:00Z",
    id: `goal:${timezone}`,
    kind: "goal",
    starts_at: startsAt,
    timezone,
    title: "Launch goal",
  };
}

describe("agenda all-day dates", () => {
  it("uses the entry timezone instead of the viewer timezone", () => {
    const utcEntry = allDayEntry("2026-08-05T00:00:00Z", "UTC");
    const pacificEntry = allDayEntry("2026-08-05T07:00:00Z", "America/Los_Angeles");

    expect(agendaEntryDayKey(utcEntry)).toBe("2026-08-05");
    expect(agendaEntryDayKey(pacificEntry)).toBe("2026-08-05");
    expect(groupAgendaEntries([utcEntry, pacificEntry])["2026-08-05"]).toHaveLength(2);
  });
});
