import type {
  CalendarMergeResult,
  GoogleCalendarEvent,
  GoogleEventPayload,
  TaskCalendarLink,
  TaskSchedule,
} from "@/api/spaces/dto/interfaces/connections/calendarTasks";
import type {
  ScheduleField,
  TaskCalendarKind,
  TaskSyncState,
} from "@/api/spaces/dto/types/connections/calendarTasks";

/**
 * Google Calendar ↔ Misty task translation.
 *
 * The product rule this file enforces: Google owns the schedule, Misty owns
 * everything else, and neither silently overwrites the other. Local edits are
 * held as "unpublished" until someone publishes them, and a remote change to
 * the same field produces a conflict the user resolves — never a lost edit.
 */

export const SCHEDULE_FIELDS: ScheduleField[] = [
  "title",
  "description",
  "location",
  "starts_at",
  "ends_at",
  "all_day",
  "timezone",
];

/** Which of the three task kinds this is. */
export function taskCalendarKind(link?: TaskCalendarLink): TaskCalendarKind {
  if (!link) return "misty";
  return link.google_event_id ? "calendar" : "draft";
}

/**
 * Google event → Misty schedule.
 *
 * All-day events arrive as bare dates and must not be reinterpreted as
 * midnight-in-some-timezone, or an event silently shifts a day for anyone in a
 * negative UTC offset.
 */
export function googleEventToSchedule(
  event: GoogleCalendarEvent,
  fallbackTimezone = "UTC",
): TaskSchedule {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  return {
    title: event.summary?.trim() || "Untitled event",
    description: event.description ?? "",
    location: event.location ?? "",
    starts_at: event.start?.dateTime ?? event.start?.date ?? "",
    ends_at: event.end?.dateTime ?? event.end?.date ?? "",
    all_day: allDay,
    timezone: event.start?.timeZone ?? fallbackTimezone,
  };
}

/**
 * Misty schedule → Google event payload.
 *
 * Google's all-day `end.date` is exclusive, so a single-day task must send the
 * following day or the event renders as zero-length.
 */
export function scheduleToGoogleEventPayload(schedule: TaskSchedule): GoogleEventPayload {
  if (schedule.all_day) {
    const start = dateOnly(schedule.starts_at);
    const end = dateOnly(schedule.ends_at || schedule.starts_at);
    return {
      summary: schedule.title.trim() || "Untitled",
      description: schedule.description,
      location: schedule.location,
      start: { date: start },
      end: { date: end === start ? nextDay(start) : end },
    };
  }
  return {
    summary: schedule.title.trim() || "Untitled",
    description: schedule.description,
    location: schedule.location,
    start: { dateTime: schedule.starts_at, timeZone: schedule.timezone },
    end: { dateTime: schedule.ends_at || schedule.starts_at, timeZone: schedule.timezone },
  };
}

/** Fields where the live schedule differs from what Google last agreed to. */
export function unpublishedFields(
  schedule: TaskSchedule,
  link?: TaskCalendarLink,
): ScheduleField[] {
  if (!link?.published) return [];
  return SCHEDULE_FIELDS.filter((field) => schedule[field] !== link.published?.[field]);
}

/** Fields Google changed since the snapshot Misty holds. */
export function remoteChangedFields(
  event: GoogleCalendarEvent,
  link: TaskCalendarLink,
  fallbackTimezone?: string,
): ScheduleField[] {
  if (!link.published) return [...SCHEDULE_FIELDS];
  const incoming = googleEventToSchedule(event, fallbackTimezone ?? link.published.timezone);
  return SCHEDULE_FIELDS.filter((field) => incoming[field] !== link.published?.[field]);
}

/**
 * Folds a Google event into a task.
 *
 * Fields only Google changed are applied. Fields only Misty changed stay put and
 * remain unpublished. Fields *both* changed are left as the local value and
 * reported as conflicts — Misty shows a publish/discard choice rather than
 * picking for the user.
 */
export function mergeGoogleEvent(
  schedule: TaskSchedule,
  link: TaskCalendarLink,
  event: GoogleCalendarEvent,
): CalendarMergeResult {
  const canceled = event.status === "cancelled";
  const incoming = googleEventToSchedule(event, schedule.timezone);
  const localChanged = new Set(unpublishedFields(schedule, link));
  const remoteChanged = new Set(remoteChangedFields(event, link, schedule.timezone));

  const merged: TaskSchedule = { ...schedule };
  const appliedFields: ScheduleField[] = [];
  const conflictedFields: ScheduleField[] = [];

  for (const field of SCHEDULE_FIELDS) {
    if (!remoteChanged.has(field)) continue;
    if (localChanged.has(field)) {
      conflictedFields.push(field);
      continue;
    }
    assignField(merged, incoming, field);
    appliedFields.push(field);
  }

  // The snapshot advances only for fields actually taken from Google. A
  // conflicted field keeps its old snapshot so the disagreement stays visible
  // until the user resolves it.
  const published: TaskSchedule = { ...(link.published ?? incoming) };
  for (const field of appliedFields) assignField(published, incoming, field);

  return {
    schedule: merged,
    link: {
      ...link,
      published,
      remote_updated_at: event.updated ?? link.remote_updated_at,
      ...(canceled ? { canceled_at: event.updated ?? new Date().toISOString() } : {}),
    },
    appliedFields,
    conflictedFields,
    unpublishedFields: unpublishedFields(merged, { ...link, published }),
    canceled,
  };
}

/**
 * Records a successful publish: Google now agrees with the local schedule, so
 * the snapshot catches up and nothing is left unpublished.
 */
export function markPublished(
  schedule: TaskSchedule,
  link: TaskCalendarLink,
  event: GoogleCalendarEvent,
): TaskCalendarLink {
  return {
    ...link,
    google_event_id: event.id || link.google_event_id,
    published: { ...schedule },
    published_at: event.updated ?? new Date().toISOString(),
    remote_updated_at: event.updated ?? link.remote_updated_at,
    last_error_code: undefined,
  };
}

/** Throws away local edits and returns to what Google holds. */
export function discardLocalChanges(link: TaskCalendarLink): TaskSchedule | undefined {
  return link.published ? { ...link.published } : undefined;
}

/**
 * The single badge a task shows. Order matters: a remotely canceled event is
 * the most urgent thing to say, and an unresolved conflict outranks a plain
 * pending edit.
 */
export function taskSyncState(
  schedule: TaskSchedule | undefined,
  link: TaskCalendarLink | undefined,
  options: { conflicted?: boolean } = {},
): TaskSyncState | undefined {
  if (!link || !schedule) return undefined;
  if (link.canceled_at) return "canceled_remotely";
  if (options.conflicted) return "conflict";
  if (link.last_error_code) return "sync_error";
  if (!link.google_event_id) return "draft";
  return unpublishedFields(schedule, link).length ? "unpublished" : "synced";
}

/** Plain-language badge copy. Sync state is only useful if it reads clearly. */
export function syncStateLabel(state: TaskSyncState): string {
  const labels: Record<TaskSyncState, string> = {
    synced: "On Google Calendar",
    draft: "Not published",
    unpublished: "Unpublished changes",
    conflict: "Needs review",
    canceled_remotely: "Canceled in Google",
    sync_error: "Sync problem",
  };
  return labels[state];
}

function assignField(target: TaskSchedule, source: TaskSchedule, field: ScheduleField) {
  if (field === "all_day") target.all_day = source.all_day;
  else target[field] = source[field] as string;
}

/** Google's all-day fields are bare `YYYY-MM-DD` dates. */
function dateOnly(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}

function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
