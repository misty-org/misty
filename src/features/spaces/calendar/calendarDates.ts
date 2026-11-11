import type { ConnectedCalendarEvent } from "@/features/agents/connectedAppsPublic";
import type { SpaceCalendarEvent, SpaceTask } from "../planner/api";

/**
 * One thing on a day: an event of the Space's calendar, a task that is due, or an event of the
 * person's own connected calendar, which only they see.
 */
export type CalendarEntry =
  | {
      kind: "connected";
      id: string;
      day: string;
      title: string;
      time: string;
      connected: ConnectedCalendarEvent;
    }
  | {
      kind: "event";
      id: string;
      day: string;
      title: string;
      time: string;
      event: SpaceCalendarEvent;
    }
  | { kind: "task"; id: string; day: string; title: string; time: string; task: SpaceTask };

export const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function startOfWeek(date: Date): Date {
  const result = startOfDay(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

/** The six weeks a month's grid shows, from the Sunday on or before the 1st. */
export function monthDays(anchor: Date): Date[] {
  const start = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(day.getDate() + index);
    return day;
  });
}

/** What to load for a month: everything its grid shows. */
export function monthRange(anchor: Date): { from: Date; to: Date } {
  const days = monthDays(anchor);
  const to = new Date(days[41]);
  to.setDate(to.getDate() + 1);
  return { from: days[0], to };
}

export function moveMonth(anchor: Date, direction: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

export const monthTitle = (anchor: Date) =>
  anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

const pad = (part: number) => String(part).padStart(2, "0");

/** `yyyy-mm-dd` in this computer's time. */
export function dayKey(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The day an event is on. An all-day event is on its day in the time zone it was made in, so it
 * does not slide to the day before for someone farther west.
 */
export function eventDayKey(
  event: Pick<SpaceCalendarEvent, "starts_at" | "all_day" | "timezone">,
): string {
  if (!event.all_day) return dayKey(event.starts_at);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: event.timezone || "UTC",
    }).formatToParts(new Date(event.starts_at));
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return dayKey(event.starts_at);
  }
}

export const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Events and due tasks as one list, grouped by day and ordered within each. */
export function calendarEntries(
  events: SpaceCalendarEvent[],
  tasks: SpaceTask[],
  connected: ConnectedCalendarEvent[] = [],
): Map<string, CalendarEntry[]> {
  const entries: CalendarEntry[] = [
    ...events.map((event): CalendarEntry => ({
      kind: "event",
      id: event.id,
      day: eventDayKey(event),
      title: event.title,
      time: event.all_day ? "" : timeLabel(event.starts_at),
      event,
    })),
    ...tasks
      .filter((task) => task.due_at && task.status !== "canceled")
      .map((task): CalendarEntry => ({
        kind: "task",
        id: task.id,
        day: dayKey(task.due_at!),
        title: task.title,
        time: "",
        task,
      })),
    ...connected.map((event): CalendarEntry => ({
      kind: "connected",
      id: event.id,
      day: event.all_day ? event.day : dayKey(event.starts_at),
      title: event.title,
      time: event.all_day ? "" : timeLabel(event.starts_at),
      connected: event,
    })),
  ];
  // Whatever has no clock time leads its day; the rest follow by when they start.
  const start = (entry: CalendarEntry) => {
    const timed =
      entry.kind === "event" ? entry.event : entry.kind === "connected" ? entry.connected : null;
    return timed && !timed.all_day ? new Date(timed.starts_at).getTime() : 0;
  };
  entries.sort((a, b) => start(a) - start(b) || a.title.localeCompare(b.title));
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  return byDay;
}

/** A day and two clock times as the instants an event starts and ends. */
export function eventTimes(
  day: string,
  allDay: boolean,
  start: string,
  end: string,
): { starts_at: string; ends_at: string } | null {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  const at = (clock: string, seconds = 0) => {
    const [hours, minutes] = clock.split(":").map(Number);
    return new Date(year, month - 1, date, hours || 0, minutes || 0, seconds);
  };
  const startsAt = allDay ? at("00:00") : at(start);
  const endsAt = allDay ? at("23:59", 59) : at(end);
  if (!allDay && (!start || !end || endsAt <= startsAt)) return null;
  return { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() };
}

/** `HH:mm` of an instant in this computer's time, as a time field holds it. */
export function clockField(value: string): string {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
