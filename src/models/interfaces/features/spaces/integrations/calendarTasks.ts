import type { ScheduleField } from "@/models/types/features/spaces/integrations/calendarTasks";

/**
 * The schedule fields Google Calendar owns. Misty edits these locally, but a
 * calendar-backed task is only "settled" once they match what Google holds.
 */
export interface TaskSchedule {
  title: string;
  description: string;
  location: string;
  /** RFC3339. For an all-day task this is the date at local midnight. */
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
}

/**
 * A task's binding to Google Calendar.
 *
 * `published` is the crux of the model: it snapshots the schedule as last agreed
 * with Google. Comparing the live schedule against it reveals local edits;
 * comparing an incoming event against it reveals remote edits. When both differ
 * on the same field, that is a genuine conflict rather than a stale write.
 */
export interface TaskCalendarLink {
  /** Misty's `SpaceCalendarSource` id. */
  source_id: string;
  google_calendar_id: string;
  /** Absent while the task is still a local draft. */
  google_event_id?: string;
  published?: TaskSchedule;
  /** Google's `updated` value at the time of the snapshot. */
  published_at?: string;
  remote_updated_at?: string;
  /** Set when Google reports the event canceled or deleted. */
  canceled_at?: string;
  last_error_code?: string;
}

/** Google Calendar event, narrowed to what Misty reads. */
export interface GoogleCalendarEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  /** Timed events carry `dateTime`; all-day events carry `date`. */
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
  created?: string;
  htmlLink?: string;
  recurringEventId?: string;
}

/** The payload Misty writes back to Google. */
export interface GoogleEventPayload {
  summary: string;
  description: string;
  location: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
}

/**
 * What a sync pass decided for one task. Nothing is applied silently: a caller
 * gets the merged schedule plus an explicit account of what changed and why.
 */
export interface CalendarMergeResult {
  schedule: TaskSchedule;
  link: TaskCalendarLink;
  /** Fields taken from Google in this merge. */
  appliedFields: ScheduleField[];
  /** Local edits held back because Google changed the same field. */
  conflictedFields: ScheduleField[];
  /** Local edits still awaiting publish. */
  unpublishedFields: ScheduleField[];
  canceled: boolean;
}
