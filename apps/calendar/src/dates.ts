/** The grid of a month: whole weeks (Sunday first) from the week the month starts in to the one it ends in. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const last = new Date(year, month + 1, 0);
  const days = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from({ length: days }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

export const sameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();

/** Whether an event, from `starts` to `ends`, touches the day. An event that ends at midnight sharp doesn't touch that day. */
export function touchesDay(starts: Date, ends: Date, day: Date): boolean {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const to = from + 24 * 60 * 60 * 1000;
  return starts.getTime() < to && (ends.getTime() > from || starts.getTime() === ends.getTime() && starts.getTime() >= from);
}

/** `<input type="datetime-local">` text for a date, in the person's own time. */
export function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
