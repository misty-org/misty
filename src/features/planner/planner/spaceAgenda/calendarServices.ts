import type { spacesApi } from "@/api/spaces/api";
import type { connectionsApi } from "@/api/connections/api";

export type PlannerCalendarServices = Pick<
  typeof spacesApi,
  | "agenda"
  | "calendarEvents"
  | "createCalendarEvent"
  | "updateCalendarEvent"
  | "deleteCalendarEvent"
  | "syncCalendarTasks"
  | "calendarSources"
  | "googleCalendars"
  | "publishGoogleCalendar"
  | "disableCalendarSource"
  | "integrations"
  | "bindAccountConnection"
>;
export type PlannerConnectionServices = Pick<typeof connectionsApi, "list" | "authorize">;
