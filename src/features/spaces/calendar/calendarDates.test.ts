import { describe, expect, it } from "vitest";
import type { SpaceCalendarEvent, SpaceTask } from "../planner/api";
import {
  calendarEntries,
  dayKey,
  eventDayKey,
  eventTimes,
  monthDays,
  monthRange,
  moveMonth,
} from "./calendarDates";

const event = (patch: Partial<SpaceCalendarEvent>): SpaceCalendarEvent => ({
  id: "event",
  space_id: "space",
  title: "Event",
  description: "",
  location: "",
  starts_at: new Date(2026, 11, 1, 9).toISOString(),
  ends_at: new Date(2026, 11, 1, 10).toISOString(),
  all_day: false,
  timezone: "UTC",
  created_by_user_id: "user",
  version: 1,
  created_at: "",
  updated_at: "",
  ...patch,
});

describe("calendar dates", () => {
  it("shows six whole weeks around a month", () => {
    const days = monthDays(new Date(2026, 11, 15));
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(0);
    expect(dayKey(days[0])).toBe("2026-11-29");
    const range = monthRange(new Date(2026, 11, 15));
    expect(dayKey(range.from)).toBe("2026-11-29");
    expect(dayKey(range.to)).toBe("2027-01-10");
  });

  it("steps from the end of a long month without skipping one", () => {
    expect(dayKey(moveMonth(new Date(2027, 0, 31), 1))).toBe("2027-02-01");
    expect(dayKey(moveMonth(new Date(2027, 0, 31), -1))).toBe("2026-12-01");
  });

  it("keeps an all-day event on the day of the time zone it was made in", () => {
    const allDay = event({
      all_day: true,
      timezone: "Asia/Tokyo",
      starts_at: "2026-12-01T15:00:00Z", // midnight on the 2nd in Tokyo
    });
    expect(eventDayKey(allDay)).toBe("2026-12-02");
  });

  it("orders a day: all-day and due tasks first, then by start time", () => {
    const due: SpaceTask = {
      id: "task",
      space_id: "space",
      task_number: 1,
      title: "Ship",
      notes: "",
      status: "todo",
      priority: "medium",
      rank: 1,
      due_at: new Date(2026, 11, 1, 12).toISOString(),
      created_by_user_id: "user",
      version: 1,
      created_at: "",
      updated_at: "",
    };
    const byDay = calendarEntries(
      [
        event({ id: "late", title: "Late", starts_at: new Date(2026, 11, 1, 15).toISOString() }),
        event({ id: "early", title: "Early" }),
      ],
      [
        due,
        { ...due, id: "canceled", status: "canceled" },
        { ...due, id: "undated", due_at: undefined },
      ],
    );
    expect(byDay.get("2026-12-01")?.map((entry) => entry.id)).toEqual(["task", "early", "late"]);
  });

  it("turns a day and clock times into an event's start and end", () => {
    const timed = eventTimes("2026-12-01", false, "09:30", "10:00");
    expect(timed && new Date(timed.starts_at).getHours()).toBe(9);
    expect(timed && new Date(timed.ends_at).getMinutes()).toBe(0);
    expect(eventTimes("2026-12-01", false, "10:00", "09:00")).toBeNull();
    const allDay = eventTimes("2026-12-01", true, "", "");
    expect(allDay && dayKey(allDay.starts_at)).toBe("2026-12-01");
    expect(allDay && dayKey(allDay.ends_at)).toBe("2026-12-01");
  });
});
