import type { ScheduleRule, ScheduleTiming } from "@/api/ai/agent-methods";
import { validRule } from "./scheduleRuleValidation";

/**
 * When a workflow runs, worked out on this computer: the same rules as the server's
 * `workflow_schedule_timing.go` and `workflow_schedule_next_run.go`. Any number of rules in one
 * timezone, minus skipped dates; a run happens at every moment any rule produces.
 */

const maxRules = 20;
const maxSkipDates = 366;
/** Long enough for a yearly rule with the largest interval to recur. */
const searchDays = 4000;
const dayMs = 86_400_000;
/** A calendar day as its UTC midnight, or null when it isn't a real date. */
export function parseDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? time
    : null;
}

const formatDate = (day: number) => new Date(day).toISOString().slice(0, 10);
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat | null {
  const known = formatters.get(timezone);
  if (known) return known;
  const name = timezone.trim();
  if (!name || name.toLowerCase() === "local" || name.length > 100) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: name,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timezone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

function localParts(timezone: string, utc: number) {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timezone)!.formatToParts(new Date(utc)))
    if (part.type !== "literal") values[part.type] = Number(part.value);
  return values;
}

/** Offsets by quarter hour: no modern zone changes between those, and catching up asks a lot. */
const offsets = new Map<string, number>();

function offsetMs(timezone: string, utc: number): number {
  const key = `${timezone}|${Math.floor(utc / 900_000)}`;
  const known = offsets.get(key);
  if (known !== undefined) return known;
  const parts = localParts(timezone, utc);
  const asLocal = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const offset = asLocal - Math.floor(utc / 1000) * 1000;
  if (offsets.size > 20_000) offsets.clear();
  offsets.set(key, offset);
  return offset;
}

/** A local wall clock moment as a real time. Across a clock change, as Go's `time.Date` reads it. */
function zonedTime(timezone: string, day: number, hour: number, minute: number): number {
  const wall = day + hour * 3_600_000 + minute * 60_000;
  return wall - offsetMs(timezone, wall - offsetMs(timezone, wall));
}

function localDay(timezone: string, utc: number): number {
  const parts = localParts(timezone, utc);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/** Whether the timing can be stored and worked out. */
export function validTiming(timing: ScheduleTiming): boolean {
  if (typeof timing.timezone !== "string" || !formatterFor(timing.timezone)) return false;
  if (!Array.isArray(timing.rules) || !timing.rules.length || timing.rules.length > maxRules)
    return false;
  const skip = timing.skip_dates ?? [];
  if (skip.length > maxSkipDates || !skip.every((day) => parseDate(day) !== null)) return false;
  return timing.rules.every((rule) => validRule(rule));
}

/** Fills defaults: an interval of 1, and today as the anchor, so "every 2 weeks" counts from now. */
export function normalizeTiming<T extends ScheduleTiming>(timing: T, now: number): T {
  if (!formatterFor(timing.timezone ?? "")) return timing;
  const today = formatDate(localDay(timing.timezone, now));
  return {
    ...timing,
    skip_dates: timing.skip_dates ?? [],
    rules: timing.rules.map((rule) =>
      rule.frequency === "once"
        ? rule
        : { ...rule, interval: rule.interval || 1, start_date: rule.start_date || today },
    ),
  };
}

function matchesDayOfMonth(rule: ScheduleRule, day: number): boolean {
  const date = new Date(day);
  const dayOfMonth = date.getUTCDate();
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  // A day past the month's end runs on its last day.
  for (const want of rule.month_days ?? [])
    if ((want === -1 && dayOfMonth === last) || (want > 0 && Math.min(want, last) === dayOfMonth))
      return true;
  for (const nth of rule.nth_weekdays ?? []) {
    if (date.getUTCDay() !== nth.weekday) continue;
    if (
      (nth.nth === -1 && dayOfMonth + 7 > last) ||
      (nth.nth > 0 && Math.floor((dayOfMonth - 1) / 7) + 1 === nth.nth)
    )
      return true;
  }
  return false;
}

function matches(rule: ScheduleRule, day: number, start: number, elapsed: number): boolean {
  const date = new Date(day);
  const from = new Date(start);
  const interval = rule.interval ?? 1;
  if (rule.weekdays?.length && !rule.weekdays.includes(date.getUTCDay())) return false;
  switch (rule.frequency) {
    case "hourly":
      return true;
    case "daily":
      return elapsed % interval === 0;
    case "weekly":
      // Weeks start on Sunday, counted from the start date's week.
      return Math.floor((elapsed + from.getUTCDay()) / 7) % interval === 0;
    case "monthly": {
      const months =
        (date.getUTCFullYear() - from.getUTCFullYear()) * 12 +
        (date.getUTCMonth() - from.getUTCMonth());
      return months % interval === 0 && matchesDayOfMonth(rule, day);
    }
    case "yearly":
      return (
        (date.getUTCFullYear() - from.getUTCFullYear()) % interval === 0 &&
        (rule.months ?? []).includes(date.getUTCMonth() + 1) &&
        matchesDayOfMonth(rule, day)
      );
    default:
      return false;
  }
}

/** A matching day's run moments, in order. */
function momentsOn(rule: ScheduleRule, day: number, timezone: string, elapsed: number): number[] {
  if (rule.frequency === "hourly") {
    const minute = rule.minute ?? 0;
    const interval = rule.interval ?? 1;
    const moments: number[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      if ((elapsed * 24 + hour) % interval !== 0) continue;
      if ((rule.from && clock < rule.from) || (rule.until && clock > rule.until)) continue;
      moments.push(zonedTime(timezone, day, hour, minute));
    }
    return moments;
  }
  return [...(rule.times ?? [])].sort().map((value) => {
    const [hour, minute] = value.split(":").map(Number);
    return zonedTime(timezone, day, hour!, minute!);
  });
}

function nextOfRule(
  rule: ScheduleRule,
  after: number,
  timezone: string,
  skip: Set<string>,
): number | null {
  if (rule.frequency === "once") {
    let best: number | null = null;
    for (const value of rule.dates ?? []) {
      if (skip.has(value)) continue;
      for (const moment of momentsOn(rule, parseDate(value)!, timezone, 0))
        if (moment > after && (best === null || moment < best)) best = moment;
    }
    return best;
  }
  const start = parseDate(rule.start_date!)!;
  const end = rule.end_date ? parseDate(rule.end_date)! : null;
  let day = Math.max(localDay(timezone, after), start);
  for (let searched = 0; searched < searchDays; searched++) {
    if (end !== null && day > end) break;
    const elapsed = Math.round((day - start) / dayMs);
    if (!skip.has(formatDate(day)) && matches(rule, day, start, elapsed))
      for (const moment of momentsOn(rule, day, timezone, elapsed))
        if (moment > after) return moment;
    day += dayMs;
  }
  return null;
}

/** The first run strictly after `after`, or null when no rule produces another. */
export function nextRun(timing: ScheduleTiming, after: number): number | null {
  if (!validTiming(timing)) throw new Error("invalid_schedule");
  const skip = new Set(timing.skip_dates ?? []);
  let best: number | null = null;
  for (const rule of timing.rules) {
    const next = nextOfRule(rule, after, timing.timezone, skip);
    if (next !== null && (best === null || next < best)) best = next;
  }
  return best;
}

/** How many runs fall after `after` and by `until`, counted no further than `limit`. */
export function runsBetween(
  timing: ScheduleTiming,
  after: number,
  until: number,
  limit: number,
): number {
  let count = 0;
  let cursor = after;
  while (count < limit) {
    const next = nextRun(timing, cursor);
    if (next === null || next > until) break;
    count++;
    cursor = next;
  }
  return count;
}
