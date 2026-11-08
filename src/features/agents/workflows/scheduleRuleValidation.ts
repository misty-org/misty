import type { ScheduleRule } from "../api/agent-methods";
import { parseDate } from "./scheduleTiming";

/** Whether one rule can be stored and worked out, as `ScheduleRule.validate` on the server. */

const maxTimes = 24;
const maxDates = 100;
const maxIntervals: Record<string, number> = {
  hourly: 23,
  daily: 365,
  weekly: 52,
  monthly: 24,
  yearly: 10,
};

const validClock = (value: unknown) =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validTimes = (times: string[] | undefined) =>
  Boolean(times?.length) && times!.length <= maxTimes && times!.every(validClock);

export function validRule(rule: ScheduleRule): boolean {
  const within = (values: number[] | undefined, low: number, high: number) =>
    (values ?? []).every((value) => Number.isInteger(value) && value >= low && value <= high);
  if (
    !within(rule.weekdays, 0, 6) ||
    !within(rule.months, 1, 12) ||
    (rule.weekdays?.length ?? 0) > 7 ||
    (rule.months?.length ?? 0) > 12 ||
    (rule.month_days?.length ?? 0) > 32 ||
    (rule.nth_weekdays?.length ?? 0) > 35
  )
    return false;
  if ((rule.month_days ?? []).some((day) => day !== -1 && !(day >= 1 && day <= 31))) return false;
  if (
    (rule.nth_weekdays ?? []).some(
      (nth) =>
        !(nth.weekday >= 0 && nth.weekday <= 6) ||
        (nth.nth !== -1 && !(nth.nth >= 1 && nth.nth <= 5)),
    )
  )
    return false;
  if (rule.frequency === "once") {
    const dates = rule.dates ?? [];
    return (
      dates.length > 0 &&
      dates.length <= maxDates &&
      validTimes(rule.times) &&
      dates.every((day) => parseDate(day) !== null)
    );
  }
  const limit = maxIntervals[rule.frequency];
  const interval = rule.interval ?? 0;
  if (!limit || !Number.isInteger(interval) || interval < 1 || interval > limit) return false;
  if (!rule.start_date || parseDate(rule.start_date) === null) return false;
  if (rule.end_date && (parseDate(rule.end_date) === null || rule.end_date < rule.start_date))
    return false;
  const days = Boolean(rule.month_days?.length || rule.nth_weekdays?.length);
  switch (rule.frequency) {
    case "hourly": {
      const minute = rule.minute ?? 0;
      if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
      if ((rule.from && !validClock(rule.from)) || (rule.until && !validClock(rule.until)))
        return false;
      return !(rule.from && rule.until && rule.until < rule.from);
    }
    case "weekly":
      if (!rule.weekdays?.length) return false;
      break;
    case "monthly":
      if (!days) return false;
      break;
    case "yearly":
      if (!days || !rule.months?.length) return false;
      break;
  }
  return validTimes(rule.times);
}
