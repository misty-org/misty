/** Days are local calendar dates, as YYYY-MM-DD. */
const pad = (n: number) => String(n).padStart(2, "0");
const key = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parse = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};

export const todayKey = () => key(new Date());

export function shiftDay(day: string, by: number) {
  const date = parse(day);
  date.setDate(date.getDate() + by);
  return key(date);
}

/** The day's start and end in local time, as RFC 3339. */
export function dayBounds(day: string) {
  return { from: parse(day).toISOString(), to: parse(shiftDay(day, 1)).toISOString() };
}

export function dayLabel(day: string, today = todayKey()) {
  if (day === today) return "Today";
  if (day === shiftDay(today, -1)) return "Yesterday";
  return parse(day).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
