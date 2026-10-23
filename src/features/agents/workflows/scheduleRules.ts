import type { ScheduleFrequency, ScheduleRule } from "@/api/ai/agent-methods";

export const scheduleFrequencies: { value: ScheduleFrequency; label: string; unit: string }[] = [
  { value: "once", label: "On specific dates", unit: "" },
  { value: "hourly", label: "Hourly", unit: "hours" },
  { value: "daily", label: "Daily", unit: "days" },
  { value: "weekly", label: "Weekly", unit: "weeks" },
  { value: "monthly", label: "Monthly", unit: "months" },
  { value: "yearly", label: "Yearly", unit: "years" },
];

/** A fresh rule of a frequency, keeping the times and dates already chosen. */
export function ruleFor(frequency: ScheduleFrequency, from?: ScheduleRule): ScheduleRule {
  const times = from?.times?.length ? from.times : ["09:00"];
  const today = new Date().toLocaleDateString("en-CA");
  switch (frequency) {
    case "once":
      return { frequency, dates: [today], times };
    case "hourly":
      return { frequency, interval: 1, minute: 0 };
    case "weekly":
      return { frequency, interval: 1, weekdays: [new Date().getDay()], times };
    case "monthly":
      return { frequency, interval: 1, month_days: [new Date().getDate()], times };
    case "yearly":
      return {
        frequency,
        interval: 1,
        months: [new Date().getMonth() + 1],
        month_days: [new Date().getDate()],
        times,
      };
    default:
      return { frequency, interval: 1, times };
  }
}

/** "1, 15, last" as month days; last is -1. */
export function parseDays(text: string) {
  return text
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => (/^last$/i.test(part) ? -1 : Number(part)))
    .filter((day) => day === -1 || (Number.isInteger(day) && day >= 1 && day <= 31));
}
