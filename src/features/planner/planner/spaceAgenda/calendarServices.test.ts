import { createMistyAppSDK, type SpaceCalendarEvent } from "@misty/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  createSDKCalendarServices,
  createSDKConnectionServices,
  plannerCalendarEvent,
} from "./calendarServices";
import { loadAgendaConnections } from "./agendaConnections";

const event: SpaceCalendarEvent = {
  id: "event-a",
  space_id: "space-a",
  source_id: "",
  provider: "misty",
  external_event_id: "",
  fingerprint: "",
  title: "Planning",
  description: "",
  location: "",
  meeting_url: "",
  organizer: null,
  starts_at: "2026-09-05T10:00:00Z",
  ends_at: "2026-09-05T11:00:00Z",
  all_day: false,
  timezone: "UTC",
  status: "confirmed",
  version: 4,
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
  removed_at: null,
};
describe("Planner calendar SDK adapter", () => {
  it("preserves event versions and validates intervals before transport", async () => {
    const request = vi.fn(async ({ method }: { method: string; params?: unknown }) =>
      method === "lifecycle.ready" || method === "calendar.events.delete" ? undefined : event,
    );
    const api = createSDKCalendarServices(createMistyAppSDK({ request }));
    await api.updateCalendarEvent("space-a", plannerCalendarEvent(event));
    await api.deleteCalendarEvent("space-a", plannerCalendarEvent(event));
    const update = request.mock.calls.find(
      ([call]) => call.method === "calendar.events.update",
    )?.[0];
    expect(update).toMatchObject({
      params: { path: { spaceID: "space-a", eventID: "event-a" }, body: { version: 4 } },
    });
    expect(
      request.mock.calls.find(([call]) => call.method === "calendar.events.delete")?.[0],
    ).toMatchObject({ params: { query: { version: 4 } } });
    await expect(
      api.agenda("space-a", "2026-09-05T00:00:00Z", "2026-09-04T00:00:00Z"),
    ).rejects.toMatchObject({ code: "invalid_params" });
    expect(request.mock.calls.some(([call]) => call.method === "agenda.list")).toBe(false);
  });
  it("shows published calendars even when account connection management is denied", async () => {
    const request = vi.fn(async ({ method }: { method: string; params?: unknown }) => {
      if (method === "lifecycle.ready") return;
      if (method === "calendar.sources.list") return { sources: null };
      if (method === "integrations.list") return { integrations: null };
      throw new Error("Connection management denied");
    });
    const sdk = createMistyAppSDK({ request });
    const api = createSDKCalendarServices(sdk);
    const accounts = createSDKConnectionServices(sdk);
    expect(await loadAgendaConnections("space-a", false, api, accounts)).toEqual({
      sources: [],
      integrations: [],
      accounts: [],
      unavailable: false,
    });
    expect(request.mock.calls.some(([call]) => call.method === "connections.list")).toBe(false);
    expect(await loadAgendaConnections("space-a", true, api, accounts)).toEqual({
      sources: [],
      integrations: [],
      accounts: [],
      unavailable: true,
    });
  });
  it("keeps the selected account and calendar capability in the named bind method", async () => {
    const request = vi.fn(async ({ method }: { method: string; params?: unknown }) =>
      method === "lifecycle.ready"
        ? undefined
        : {
            integration: {
              id: "integration-a",
              space_id: "space-a",
              provider: "google",
              display_name: "Calendar",
              granted_permissions: null,
              status: "active",
              connected_by_user_id: "user-a",
              created_at: "2026-09-05T00:00:00Z",
              updated_at: "2026-09-05T00:00:00Z",
              credential_reference: "private",
            },
            connection_id: "account-a",
            capability: "calendar_read",
          },
    );
    const api = createSDKCalendarServices(createMistyAppSDK({ request }));
    const result = await api.bindAccountConnection(
      "space-a",
      "google",
      "account-a",
      "calendar_read",
    );
    expect(result.integration.granted_permissions).toEqual([]);
    expect(result.integration).not.toHaveProperty("credential_reference");
    expect(
      request.mock.calls.find(([call]) => call.method === "integrations.bind")?.[0],
    ).toMatchObject({
      params: {
        path: { spaceID: "space-a", provider: "google" },
        body: { connection_id: "account-a", capability: "calendar_read" },
      },
    });
  });
});
