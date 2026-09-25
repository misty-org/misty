import {
  CalendarCreateInputSchema,
  CalendarUpdateInputSchema,
  type MistyAppSDK,
  type SpaceCalendarEvent as SDKEvent,
  type SpaceCalendarSource as SDKSource,
  type SpaceAgendaEntry as SDKEntry,
} from "@misty/sdk";
import type { spacesApi } from "@/api/spaces/api";
import type { connectionsApi } from "@/api/connections/api";
import type { SpaceCalendarEvent, SpaceCalendarSource } from "@/api/spaces/dto/interfaces/types";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { IntegrationCapability } from "@/shared/integrations/types";
import { plannerEnum, plannerRecord } from "../plannerValues";
import { plannerTask } from "../spaceTasks/taskServices";

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

export function plannerCalendarEvent(event: SDKEvent): SpaceCalendarEvent {
  return {
    ...event,
    status: plannerEnum(event.status, ["confirmed", "tentative", "canceled"]),
    organizer: plannerRecord(event.organizer),
    provider_created_at: event.provider_created_at ?? undefined,
    provider_updated_at: event.provider_updated_at ?? undefined,
    removed_at: event.removed_at ?? undefined,
    audience_kind: event.audience_kind
      ? plannerEnum(event.audience_kind, ["space", "conversation"])
      : undefined,
  };
}
export function plannerCalendarSource(source: SDKSource): SpaceCalendarSource {
  return {
    ...source,
    status: plannerEnum(source.status, [
      "pending",
      "syncing",
      "active",
      "needs_attention",
      "disabled",
    ]),
    watch_expires_at: source.watch_expires_at ?? undefined,
    last_reconciled_at: source.last_reconciled_at ?? undefined,
    disabled_at: source.disabled_at ?? undefined,
  };
}
export function plannerAgendaEntry(entry: SDKEntry): SpaceAgendaEntry {
  return {
    ...entry,
    kind: plannerEnum(entry.kind, ["task", "event", "goal", "milestone", "roadmap_node"]),
    roadmap_node_kind: entry.roadmap_node_kind
      ? plannerEnum(entry.roadmap_node_kind, ["risk", "decision", "metric", "note", "custom"])
      : undefined,
  };
}

export function createSDKCalendarServices(misty: MistyAppSDK): PlannerCalendarServices {
  return {
    async agenda(spaceID, from, to) {
      const result = await misty.server.call("agenda.list", {
        path: { spaceID },
        query: { from, to },
      });
      return { entries: (result.entries ?? []).map(plannerAgendaEntry) };
    },
    async calendarEvents(spaceID, from, to) {
      const result = await misty.server.call("calendar.events.list", {
        path: { spaceID },
        query: { from, to },
      });
      return { events: (result.events ?? []).map(plannerCalendarEvent) };
    },
    async createCalendarEvent(spaceID, event) {
      return plannerCalendarEvent(
        await misty.server.call("calendar.events.create", {
          path: { spaceID },
          body: CalendarCreateInputSchema.parse(event),
        }),
      );
    },
    async updateCalendarEvent(spaceID, event) {
      return plannerCalendarEvent(
        await misty.server.call("calendar.events.update", {
          path: { spaceID, eventID: event.id },
          body: CalendarUpdateInputSchema.parse({ ...event, version: event.version ?? 1 }),
        }),
      );
    },
    deleteCalendarEvent: (spaceID, event) =>
      misty.server.call("calendar.events.delete", {
        path: { spaceID, eventID: event.id },
        query: { version: event.version ?? 1 },
      }),
    async syncCalendarTasks(spaceID, sourceId) {
      const result = await misty.server.call("calendar.sync", {
        path: { spaceID },
        body: { source_id: sourceId },
      });
      return {
        ...result,
        tasks: (result.tasks ?? []).map(plannerTask),
        sources: (result.sources ?? []).map(plannerCalendarSource),
      };
    },
    async calendarSources(spaceID) {
      const result = await misty.server.call("calendar.sources.list", { path: { spaceID } });
      return { sources: (result.sources ?? []).map(plannerCalendarSource) };
    },
    async googleCalendars(spaceID, integrationId) {
      const result = await misty.server.call("calendar.google.calendars", {
        path: { spaceID },
        query: { integration_id: integrationId },
      });
      return { calendars: result.calendars ?? [] };
    },
    async publishGoogleCalendar(spaceID, integrationId, calendar) {
      return plannerCalendarSource(
        await misty.server.call("calendar.sources.create", {
          path: { spaceID },
          body: {
            integration_id: integrationId,
            external_calendar_id: calendar.id,
            display_name: calendar.summary,
            timezone: calendar.timeZone || "UTC",
          },
        }),
      );
    },
    disableCalendarSource: (spaceID, sourceID) =>
      misty.server.call("calendar.sources.delete", { path: { spaceID, sourceID } }),
    async integrations(spaceID) {
      const result = await misty.server.call("integrations.list", { path: { spaceID } });
      return {
        integrations: (result.integrations ?? []).map((item) => ({
          ...item,
          granted_permissions: item.granted_permissions ?? [],
        })),
        providers: result.providers ?? undefined,
      };
    },
    async bindAccountConnection(spaceID, provider, connectionId, capability) {
      const result = await misty.server.call("integrations.bind", {
        path: { spaceID, provider },
        body: { connection_id: connectionId, capability },
      });
      return {
        ...result,
        integration: {
          ...result.integration,
          granted_permissions: result.integration.granted_permissions ?? [],
        },
      };
    },
  };
}

const uiCapabilities: readonly IntegrationCapability[] = [
  "mail",
  "chat",
  "notes",
  "calendar",
  "calendar_read",
  "calendar_write",
  "source_control",
  "shell",
  "files",
  "drawings",
  "drawings_read",
  "drawings_projects",
  "drawings_comments",
  "drawings_webhooks",
  "social_read",
  "social_send",
  "social_automation",
  "agent_tools",
];
export function createSDKConnectionServices(misty: MistyAppSDK): PlannerConnectionServices {
  return {
    async list() {
      const result = await misty.server.call("connections.list", {});
      return {
        providers: result.providers,
        connections: (result.connections ?? []).map((item) => ({
          ...item,
          granted_scopes: item.granted_scopes ?? [],
          capabilities: uiCapabilities.filter((capability) =>
            item.capabilities?.includes(capability),
          ),
        })),
      };
    },
    authorize: (provider, capabilities, returnTo = "/apps/planner") =>
      misty.server.call("connections.authorize", {
        path: { provider },
        body: { capabilities, return_to: returnTo },
      }),
  };
}
