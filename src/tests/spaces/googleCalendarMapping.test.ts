import { describe, expect, it } from "vitest";

import {
  discardLocalChanges,
  googleEventToSchedule,
  markPublished,
  mergeGoogleEvent,
  remoteChangedFields,
  scheduleToGoogleEventPayload,
  syncStateLabel,
  taskCalendarKind,
  taskSyncState,
  unpublishedFields,
} from "@/features/spaces/connections/googleCalendarMapping";
import type {
  GoogleCalendarEvent,
  TaskCalendarLink,
  TaskSchedule,
} from "@/models/interfaces/features/spaces/connections/calendarTasks";

function schedule(overrides: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    title: "Design review",
    description: "Walk through the beta board.",
    location: "Room 2",
    starts_at: "2026-07-27T15:00:00.000Z",
    ends_at: "2026-07-27T16:00:00.000Z",
    all_day: false,
    timezone: "America/Los_Angeles",
    ...overrides,
  };
}

function link(overrides: Partial<TaskCalendarLink> = {}): TaskCalendarLink {
  return {
    source_id: "source-1",
    google_calendar_id: "team@group.calendar.google.com",
    google_event_id: "event-1",
    published: schedule(),
    ...overrides,
  };
}

function event(overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id: "event-1",
    status: "confirmed",
    summary: "Design review",
    description: "Walk through the beta board.",
    location: "Room 2",
    start: { dateTime: "2026-07-27T15:00:00.000Z", timeZone: "America/Los_Angeles" },
    end: { dateTime: "2026-07-27T16:00:00.000Z", timeZone: "America/Los_Angeles" },
    updated: "2026-07-20T09:00:00.000Z",
    ...overrides,
  };
}

describe("taskCalendarKind", () => {
  it("distinguishes the three task types", () => {
    expect(taskCalendarKind(undefined)).toBe("misty");
    expect(taskCalendarKind(link({ google_event_id: undefined }))).toBe("draft");
    expect(taskCalendarKind(link())).toBe("calendar");
  });
});

describe("googleEventToSchedule", () => {
  it("maps a timed event", () => {
    expect(googleEventToSchedule(event())).toEqual(schedule());
  });

  it("treats a date-only event as all-day without shifting the day", () => {
    const mapped = googleEventToSchedule(
      event({ start: { date: "2026-07-27" }, end: { date: "2026-07-28" } }),
      "America/Los_Angeles",
    );
    expect(mapped.all_day).toBe(true);
    expect(mapped.starts_at).toBe("2026-07-27");
    expect(mapped.ends_at).toBe("2026-07-28");
  });

  it("gives an untitled Google event a readable name", () => {
    expect(googleEventToSchedule(event({ summary: "   " })).title).toBe("Untitled event");
  });

  it("tolerates an event with no description or location", () => {
    const mapped = googleEventToSchedule(event({ description: undefined, location: undefined }));
    expect(mapped.description).toBe("");
    expect(mapped.location).toBe("");
  });
});

describe("scheduleToGoogleEventPayload", () => {
  it("sends timed events with an explicit timezone", () => {
    const payload = scheduleToGoogleEventPayload(schedule());
    expect(payload.start).toEqual({
      dateTime: "2026-07-27T15:00:00.000Z",
      timeZone: "America/Los_Angeles",
    });
    expect(payload.summary).toBe("Design review");
  });

  it("makes a single all-day task span one day, since Google's end is exclusive", () => {
    const payload = scheduleToGoogleEventPayload(
      schedule({ all_day: true, starts_at: "2026-07-27", ends_at: "2026-07-27" }),
    );
    expect(payload.start).toEqual({ date: "2026-07-27" });
    expect(payload.end).toEqual({ date: "2026-07-28" });
  });

  it("keeps a multi-day all-day range as given", () => {
    const payload = scheduleToGoogleEventPayload(
      schedule({ all_day: true, starts_at: "2026-07-27", ends_at: "2026-07-30" }),
    );
    expect(payload.end).toEqual({ date: "2026-07-30" });
  });

  it("falls back to the start when a task has no end", () => {
    const payload = scheduleToGoogleEventPayload(schedule({ ends_at: "" }));
    expect(payload.end.dateTime).toBe("2026-07-27T15:00:00.000Z");
  });

  it("never publishes an empty title", () => {
    expect(scheduleToGoogleEventPayload(schedule({ title: "  " })).summary).toBe("Untitled");
  });
});

describe("unpublishedFields", () => {
  it("reports nothing when local matches what Google agreed to", () => {
    expect(unpublishedFields(schedule(), link())).toEqual([]);
  });

  it("reports exactly the locally edited fields", () => {
    const edited = schedule({ title: "Design review v2", location: "Room 5" });
    expect(unpublishedFields(edited, link())).toEqual(["title", "location"]);
  });

  it("reports nothing for a Misty-only task", () => {
    expect(unpublishedFields(schedule(), undefined)).toEqual([]);
  });
});

describe("remoteChangedFields", () => {
  it("reports the fields Google changed", () => {
    expect(remoteChangedFields(event({ location: "Room 9" }), link())).toEqual(["location"]);
  });

  it("treats everything as changed when there is no snapshot yet", () => {
    expect(remoteChangedFields(event(), link({ published: undefined })).length).toBeGreaterThan(0);
  });
});

describe("mergeGoogleEvent", () => {
  it("applies a remote change to an untouched field", () => {
    const result = mergeGoogleEvent(schedule(), link(), event({ location: "Room 9" }));

    expect(result.schedule.location).toBe("Room 9");
    expect(result.appliedFields).toEqual(["location"]);
    expect(result.conflictedFields).toEqual([]);
    expect(result.unpublishedFields).toEqual([]);
  });

  it("keeps a local edit Google did not touch, still unpublished", () => {
    const edited = schedule({ title: "Design review v2" });
    const result = mergeGoogleEvent(edited, link(), event({ location: "Room 9" }));

    expect(result.schedule.title).toBe("Design review v2");
    expect(result.schedule.location).toBe("Room 9");
    expect(result.unpublishedFields).toEqual(["title"]);
    expect(result.conflictedFields).toEqual([]);
  });

  it("never silently overwrites a local edit to the same field", () => {
    const edited = schedule({ location: "Room 5" });
    const result = mergeGoogleEvent(edited, link(), event({ location: "Room 9" }));

    expect(result.schedule.location).toBe("Room 5");
    expect(result.conflictedFields).toEqual(["location"]);
    expect(result.appliedFields).toEqual([]);
  });

  it("keeps a conflicted field's old snapshot so the disagreement stays visible", () => {
    const edited = schedule({ location: "Room 5" });
    const result = mergeGoogleEvent(edited, link(), event({ location: "Room 9" }));

    expect(result.link.published?.location).toBe("Room 2");
    // Re-merging the same event must still report the conflict, not resolve it.
    const again = mergeGoogleEvent(result.schedule, result.link, event({ location: "Room 9" }));
    expect(again.conflictedFields).toEqual(["location"]);
  });

  it("advances the snapshot for fields it did take from Google", () => {
    const result = mergeGoogleEvent(schedule(), link(), event({ location: "Room 9" }));
    expect(result.link.published?.location).toBe("Room 9");
  });

  it("records the provider's update time", () => {
    const result = mergeGoogleEvent(
      schedule(),
      link(),
      event({ location: "Room 9", updated: "2026-07-21T08:00:00.000Z" }),
    );
    expect(result.link.remote_updated_at).toBe("2026-07-21T08:00:00.000Z");
  });

  it("handles a time change on both start and end", () => {
    const result = mergeGoogleEvent(
      schedule(),
      link(),
      event({
        start: { dateTime: "2026-07-27T17:00:00.000Z", timeZone: "America/Los_Angeles" },
        end: { dateTime: "2026-07-27T18:00:00.000Z", timeZone: "America/Los_Angeles" },
      }),
    );
    expect(result.schedule.starts_at).toBe("2026-07-27T17:00:00.000Z");
    expect(result.appliedFields).toEqual(["starts_at", "ends_at"]);
  });
});

describe("canceled and deleted events", () => {
  it("marks the task canceled instead of making it disappear", () => {
    const result = mergeGoogleEvent(schedule(), link(), event({ status: "cancelled" }));

    expect(result.canceled).toBe(true);
    expect(result.link.canceled_at).toBe("2026-07-20T09:00:00.000Z");
    expect(result.schedule.title).toBe("Design review");
  });

  it("surfaces cancellation ahead of any other sync state", () => {
    const canceled = link({ canceled_at: "2026-07-20T09:00:00.000Z" });
    expect(taskSyncState(schedule({ title: "edited" }), canceled)).toBe("canceled_remotely");
  });
});

describe("markPublished", () => {
  it("clears the unpublished state once Google accepts the write", () => {
    const edited = schedule({ title: "Design review v2" });
    const published = markPublished(edited, link(), event({ updated: "2026-07-21T10:00:00.000Z" }));

    expect(unpublishedFields(edited, published)).toEqual([]);
    expect(published.published_at).toBe("2026-07-21T10:00:00.000Z");
  });

  it("adopts the event id when publishing a draft for the first time", () => {
    const draft = link({ google_event_id: undefined, published: undefined });
    const published = markPublished(schedule(), draft, event({ id: "new-event" }));

    expect(published.google_event_id).toBe("new-event");
    expect(taskCalendarKind(published)).toBe("calendar");
  });

  it("clears a previous sync error", () => {
    const failing = link({ last_error_code: "rate_limited" });
    expect(markPublished(schedule(), failing, event()).last_error_code).toBeUndefined();
  });
});

describe("discardLocalChanges", () => {
  it("returns to what Google holds", () => {
    expect(discardLocalChanges(link())?.title).toBe("Design review");
  });

  it("has nothing to fall back to for an unpublished draft", () => {
    expect(discardLocalChanges(link({ published: undefined }))).toBeUndefined();
  });
});

describe("taskSyncState", () => {
  it("says nothing for a Misty-only task", () => {
    expect(taskSyncState(schedule(), undefined)).toBeUndefined();
  });

  it("reports a draft that has never been published", () => {
    expect(taskSyncState(schedule(), link({ google_event_id: undefined }))).toBe("draft");
  });

  it("reports pending local edits", () => {
    expect(taskSyncState(schedule({ title: "changed" }), link())).toBe("unpublished");
  });

  it("reports a settled task as synced", () => {
    expect(taskSyncState(schedule(), link())).toBe("synced");
  });

  it("ranks a conflict above a plain pending edit", () => {
    expect(taskSyncState(schedule({ title: "changed" }), link(), { conflicted: true })).toBe(
      "conflict",
    );
  });

  it("reports a sync error", () => {
    expect(taskSyncState(schedule(), link({ last_error_code: "forbidden" }))).toBe("sync_error");
  });

  it("gives every state plain-language copy", () => {
    expect(syncStateLabel("unpublished")).toBe("Unpublished changes");
    expect(syncStateLabel("canceled_remotely")).toBe("Canceled in Google");
    expect(syncStateLabel("conflict")).toBe("Needs review");
  });
});
