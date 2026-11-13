import { invoke } from "@/native/invoke";

/** One event of the person's connected Google Calendar. It is read on this computer and stays here. */
export interface ConnectedCalendarEvent {
  id: string;
  /** The connected account it came from. */
  account: string;
  title: string;
  location: string;
  /** Set unless the event is all day. */
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  /** `yyyy-mm-dd`, for an all-day event. */
  day: string;
  /** The event's page in Google Calendar, when there is one. */
  url: string;
}

/**
 * The connected calendar's events between two instants. Native code holds the Composio key, picks the
 * one read that runs, and answers an empty list when no key or calendar is connected.
 */
export function connectedCalendarEvents(from: string, to: string) {
  return invoke<ConnectedCalendarEvent[]>("composio_calendar_events", { from, to });
}
