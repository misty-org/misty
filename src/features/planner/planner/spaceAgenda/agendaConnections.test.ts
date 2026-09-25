import { beforeEach, expect, it, vi } from "vitest";
import { loadAgendaConnections } from "./agendaConnections";
const api = vi.hoisted(() => ({ sources: vi.fn(), integrations: vi.fn(), connections: vi.fn() }));
const spaces = { calendarSources: api.sources, integrations: api.integrations };
const connections = { list: api.connections };
beforeEach(() => {
  vi.clearAllMocks();
  api.sources.mockResolvedValue({ sources: [{ id: "published" }] });
  api.integrations.mockResolvedValue({ integrations: [] });
  api.connections.mockResolvedValue({ connections: [] });
});
it("loads published calendars without making owner-only connection requests", async () => {
  expect(await loadAgendaConnections("space", false, spaces, connections)).toMatchObject({
    sources: [{ id: "published" }],
    unavailable: false,
  });
  expect(api.integrations).not.toHaveBeenCalled();
  expect(api.connections).not.toHaveBeenCalled();
});
it("keeps published sources usable when an optional manager lookup is denied", async () => {
  api.connections.mockRejectedValue(new Error("403"));
  expect(await loadAgendaConnections("space", true, spaces, connections)).toMatchObject({
    sources: [{ id: "published" }],
    accounts: [],
    unavailable: true,
  });
  expect(api.integrations).toHaveBeenCalledWith("space");
});
