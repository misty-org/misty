import { describe, expect, it } from "vitest";
import type { ScheduleRule, ScheduleTiming } from "@/features/agents/api/agent-methods";
import { nextRun, normalizeTiming, runsBetween, validTiming } from "./scheduleTiming";

// Friday 2026-09-25 10:00 in Los Angeles: the server's own test cases.
const now = Date.UTC(2026, 8, 25, 17);
const la = "America/Los_Angeles";

function rule(value: ScheduleRule): ScheduleTiming {
  return {
    timezone: la,
    skip_dates: [],
    rules: [
      {
        ...value,
        ...(value.frequency === "once"
          ? {}
          : { start_date: value.start_date ?? "2026-09-01", interval: value.interval ?? 1 }),
      },
    ],
  };
}

function inLa(time: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: la,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(time))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

describe("nextRun", () => {
  const cases: [string, ScheduleRule, string][] = [
    ["daily later today", { frequency: "daily", times: ["11:30"] }, "2026-09-25T11:30"],
    ["daily already passed", { frequency: "daily", times: ["09:00"] }, "2026-09-26T09:00"],
    ["several times a day", { frequency: "daily", times: ["17:00", "09:00"] }, "2026-09-25T17:00"],
    ["every other day", { frequency: "daily", interval: 2, times: ["09:00"] }, "2026-09-27T09:00"],
    [
      "weekdays skip the weekend",
      { frequency: "weekly", weekdays: [1, 2, 3, 4, 5], times: ["09:00"] },
      "2026-09-28T09:00",
    ],
    [
      "every two weeks",
      { frequency: "weekly", interval: 2, weekdays: [4], times: ["09:00"] },
      "2026-10-01T09:00",
    ],
    [
      "monthly clamps to a short month",
      { frequency: "monthly", month_days: [31], times: ["08:00"] },
      "2026-09-30T08:00",
    ],
    [
      "last day of the month",
      { frequency: "monthly", month_days: [-1], times: ["08:00"] },
      "2026-09-30T08:00",
    ],
    [
      "first Monday",
      { frequency: "monthly", nth_weekdays: [{ nth: 1, weekday: 1 }], times: ["08:00"] },
      "2026-10-05T08:00",
    ],
    [
      "last Friday",
      { frequency: "monthly", nth_weekdays: [{ nth: -1, weekday: 5 }], times: ["12:00"] },
      "2026-09-25T12:00",
    ],
    [
      "yearly in a month",
      { frequency: "yearly", months: [1], month_days: [1], times: ["00:05"] },
      "2027-01-01T00:05",
    ],
    [
      "hourly within a window",
      {
        frequency: "hourly",
        interval: 3,
        minute: 15,
        from: "09:00",
        until: "17:00",
        weekdays: [5],
      },
      "2026-09-25T12:15",
    ],
    [
      "once in the future",
      { frequency: "once", dates: ["2026-10-01", "2026-09-30"], times: ["12:00"] },
      "2026-09-30T12:00",
    ],
  ];
  it.each(cases)("%s", (_name, value, want) => {
    expect(inLa(nextRun(rule(value), now)!)).toBe(want);
  });

  it("combines rules and skips dates", () => {
    const timing: ScheduleTiming = {
      timezone: la,
      skip_dates: ["2026-09-28"],
      rules: [
        {
          frequency: "weekly",
          interval: 1,
          start_date: "2026-09-01",
          weekdays: [1],
          times: ["09:00"],
        },
        {
          frequency: "monthly",
          interval: 1,
          start_date: "2026-09-01",
          month_days: [1],
          times: ["08:00"],
        },
      ],
    };
    expect(inLa(nextRun(timing, now)!)).toBe("2026-10-01T08:00");
  });

  it("has no next run when a rule ended or its dates passed", () => {
    expect(
      nextRun(
        {
          timezone: "UTC",
          skip_dates: [],
          rules: [
            {
              frequency: "daily",
              interval: 1,
              start_date: "2026-09-01",
              end_date: "2026-09-20",
              times: ["09:00"],
            },
          ],
        },
        now,
      ),
    ).toBeNull();
    expect(
      nextRun(
        {
          timezone: "UTC",
          skip_dates: [],
          rules: [{ frequency: "once", dates: ["2026-09-01"], times: ["09:00"] }],
        },
        now,
      ),
    ).toBeNull();
  });

  it("keeps its local time across a clock change", () => {
    const before = Date.UTC(2026, 10, 1, 7); // Just before fall back in Los Angeles.
    const next = nextRun(rule({ frequency: "daily", times: ["09:00"] }), before)!;
    expect(inLa(next)).toBe("2026-11-01T09:00");
  });

  it("counts the runs between two moments, up to a limit", () => {
    const timing = rule({ frequency: "hourly", minute: 0 });
    expect(runsBetween(timing, now, now + 5 * 3_600_000, 100)).toBe(5);
    expect(runsBetween(timing, now, now + 5 * 3_600_000, 3)).toBe(3);
  });
});

describe("validTiming", () => {
  it("fills defaults from today in the schedule's timezone", () => {
    const timing = normalizeTiming(
      {
        timezone: "UTC",
        rules: [{ frequency: "daily", times: ["09:00"] }],
      } as unknown as ScheduleTiming,
      Date.UTC(2026, 8, 25, 12),
    );
    expect(timing.rules[0]).toMatchObject({ interval: 1, start_date: "2026-09-25" });
    expect(timing.skip_dates).toEqual([]);
    expect(validTiming(timing)).toBe(true);
  });

  const start = { interval: 1, start_date: "2026-09-01" };
  it.each<[string, Partial<ScheduleTiming>]>([
    ["no rules", { timezone: "UTC", rules: [] }],
    [
      "a local timezone",
      { timezone: "local", rules: [{ frequency: "daily", ...start, times: ["09:00"] }] },
    ],
    [
      "an unknown timezone",
      { timezone: "Mars/Olympus", rules: [{ frequency: "daily", ...start, times: ["09:00"] }] },
    ],
    [
      "an unknown frequency",
      {
        timezone: "UTC",
        rules: [{ frequency: "minutely" as "daily", ...start, times: ["09:00"] }],
      },
    ],
    [
      "a bad clock",
      { timezone: "UTC", rules: [{ frequency: "daily", ...start, times: ["25:00"] }] },
    ],
    [
      "weekly without weekdays",
      { timezone: "UTC", rules: [{ frequency: "weekly", ...start, times: ["09:00"] }] },
    ],
    [
      "monthly without days",
      { timezone: "UTC", rules: [{ frequency: "monthly", ...start, times: ["09:00"] }] },
    ],
    [
      "yearly without months",
      {
        timezone: "UTC",
        rules: [{ frequency: "yearly", ...start, month_days: [1], times: ["09:00"] }],
      },
    ],
    ["once without dates", { timezone: "UTC", rules: [{ frequency: "once", times: ["09:00"] }] }],
    [
      "an end before the start",
      {
        timezone: "UTC",
        rules: [
          {
            frequency: "daily",
            interval: 1,
            start_date: "2026-09-10",
            end_date: "2026-09-01",
            times: ["09:00"],
          },
        ],
      },
    ],
    [
      "a date that isn't real",
      { timezone: "UTC", rules: [{ frequency: "once", dates: ["2026-02-30"], times: ["09:00"] }] },
    ],
  ])("refuses %s", (_name, timing) => {
    expect(validTiming({ skip_dates: [], ...timing } as ScheduleTiming)).toBe(false);
  });
});
