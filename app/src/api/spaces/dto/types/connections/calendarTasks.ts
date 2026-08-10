/**
 * How a task relates to Google Calendar.
 *
 * - `calendar` — backed by a real Google event; Google owns the schedule fields.
 * - `draft` — targeted at a calendar but not published yet; Misty-only until it is.
 * - `misty` — never syncs. Unscheduled or non-calendar work.
 */
export type TaskCalendarKind = "calendar" | "draft" | "misty";

/**
 * What the board badge needs to say. `conflict` is the important one: it means
 * local edits and a Google update touch the same field, so Misty refuses to
 * pick a winner and asks instead.
 */
export type TaskSyncState =
  "synced" | "draft" | "unpublished" | "conflict" | "canceled_remotely" | "sync_error";

/** How a user resolved a conflict between local edits and a Google update. */
export type ConflictResolution = "publish_local" | "discard_local";

/** Schedule fields Google Calendar is the source of truth for. */
export type ScheduleField =
  "title" | "description" | "location" | "starts_at" | "ends_at" | "all_day" | "timezone";
