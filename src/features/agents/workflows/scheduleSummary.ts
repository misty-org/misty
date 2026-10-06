import type { ScheduleRule, ScheduleTiming, WorkflowSchedule } from "@/api/ai/agent-methods";

export const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const weekdayLongNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export const nthNames: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  [-1]: "last",
};

function list(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "09:30" as the viewer's clock, such as "9:30 AM". */
export function formatClock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(value: string, withYear = false) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function ordinal(day: number) {
  if (day === -1) return "last day";
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${day}${suffix}`;
}

function days(weekdays: number[]) {
  const sorted = [...weekdays].sort();
  if (sorted.join() === "1,2,3,4,5") return "weekdays";
  if (sorted.join() === "0,6") return "weekends";
  if (sorted.length === 7) return "every day";
  return list(sorted.map((day) => weekdayNames[day]));
}

function every(interval: number | undefined, unit: string) {
  return !interval || interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

function onDays(rule: ScheduleRule) {
  const parts = [
    ...(rule.month_days ?? []).map((day) => `the ${ordinal(day)}`),
    ...(rule.nth_weekdays ?? []).map(
      (nth) => `the ${nthNames[nth.nth]} ${weekdayLongNames[nth.weekday]}`,
    ),
  ];
  return parts.length ? ` on ${list(parts)}` : "";
}

/** One rule in plain words, such as "Every 2 weeks on Mon and Thu at 9:00 AM". */
export function describeRule(rule: ScheduleRule) {
  const at = rule.times?.length ? ` at ${list(rule.times.map(formatClock))}` : "";
  const until = rule.end_date ? `, until ${formatDate(rule.end_date, true)}` : "";
  switch (rule.frequency) {
    case "once":
      return `On ${list((rule.dates ?? []).map((d) => formatDate(d, true)))}${at}`;
    case "hourly": {
      const window =
        rule.from || rule.until
          ? `, ${rule.from ? formatClock(rule.from) : "midnight"}–${rule.until ? formatClock(rule.until) : "midnight"}`
          : "";
      const only = rule.weekdays?.length ? ` on ${days(rule.weekdays)}` : "";
      return `${every(rule.interval, "hour")} at :${String(rule.minute ?? 0).padStart(2, "0")}${window}${only}${until}`;
    }
    case "daily": {
      const only = rule.weekdays?.length ? ` on ${days(rule.weekdays)}` : "";
      return `${every(rule.interval, "day")}${only}${at}${until}`;
    }
    case "weekly":
      return `${every(rule.interval, "week")} on ${days(rule.weekdays ?? [])}${at}${until}`;
    case "monthly":
      return `${every(rule.interval, "month")}${onDays(rule)}${at}${until}`;
    case "yearly": {
      const months = list((rule.months ?? []).map((m) => monthNames[m - 1]));
      return `${every(rule.interval, "year")} in ${months}${onDays(rule)}${at}${until}`;
    }
  }
}

/** The whole timing, one rule per clause. */
export function describeSchedule(timing: ScheduleTiming) {
  const rules = timing.rules.map(describeRule).join("; ");
  const skipped = timing.skip_dates.length
    ? ` · ${timing.skip_dates.length} ${timing.skip_dates.length === 1 ? "date" : "dates"} skipped`
    : "";
  return rules + skipped;
}

/** "Next Tue 9:00 AM", or why there is none. */
export function describeNextRun(schedule: WorkflowSchedule) {
  if (!schedule.enabled) return "Paused";
  if (!schedule.next_run_at) return "No upcoming runs";
  const next = new Date(schedule.next_run_at);
  const soon = next.getTime() - Date.now() < 6 * 24 * 60 * 60 * 1000;
  return `Next ${next.toLocaleString(undefined, {
    ...(soon ? { weekday: "short" } : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  })}`;
}
