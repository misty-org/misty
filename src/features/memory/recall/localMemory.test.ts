import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client/errors";

const fixture = vi.hoisted(() => ({ invoke: vi.fn(), model: vi.fn(), vector: vi.fn() }));

vi.mock("@/native/invoke", () => ({ invoke: fixture.invoke }));
vi.mock("@/api/runtime/device-models", () => ({ deviceModelCall: fixture.model }));
vi.mock("@/api/runtime/device-embeddings", () => ({
  queryVector: fixture.vector,
  embedOnDevice: vi.fn(),
}));
vi.mock("./windowSpace", () => ({
  windowSpaceId: () => "window-space",
  memorySpaceKey: (space?: string) => (space === "personal-id" ? "" : (space ?? "")),
}));

const { localMemory } = await import("./localMemory");

const event = (id: string, at: string, extra = {}) => ({
  id,
  kind: "page",
  title: id,
  site: "example.com",
  occurred_at: at,
  dwell_ms: 0,
  ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("the app's Memory on this computer", () => {
  it("records in the window's Space, or the one named, with the personal Space empty", async () => {
    fixture.invoke.mockResolvedValue({ id: "1", same_as: "" });
    await localMemory.record({ kind: "note", title: "x" });
    expect(fixture.invoke.mock.calls[0][1].event.space_id).toBe("window-space");
    await localMemory.record({ kind: "note", title: "x", space_id: "personal-id" });
    expect(fixture.invoke.mock.calls[1][1].event.space_id).toBe("");
  });

  it("answers a full backlog as the server does, so the recorder backs off", async () => {
    fixture.invoke.mockRejectedValue("memory_backlog_full");
    const error = await localMemory.record({ kind: "note", title: "x" }).catch((reason) => reason);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(429);
  });

  it("searches by meaning and keeps the ranking", async () => {
    fixture.vector.mockResolvedValue({ model: "m", vector: [1] });
    fixture.invoke.mockImplementation(async (command: string) =>
      command === "memory_search"
        ? [
            { branch: "moments", record_id: "b", text: "", distance: 0.1 },
            { branch: "moments", record_id: "a", text: "", distance: 0.2 },
          ]
        : [event("a", "2026-11-06T10:00:00Z"), event("b", "2026-11-06T09:00:00Z")],
    );
    const { events } = await localMemory.events({ q: "the page", limit: 20 });
    expect(events.map((item) => item.id)).toEqual(["b", "a"]);
    const listed = fixture.invoke.mock.calls.find(([command]) => command === "memory_events");
    expect(listed?.[1].query.ids).toEqual(["b", "a"]);
    expect(listed?.[1].query.q).toBeUndefined();
  });

  it("finds nothing by meaning with no embedding model", async () => {
    fixture.vector.mockResolvedValue(null);
    await expect(localMemory.events({ q: "the page" })).resolves.toEqual({ events: [] });
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it("writes a day's recap on this computer's model and keeps it", async () => {
    fixture.invoke.mockImplementation(async (command: string) =>
      command === "memory_events"
        ? [
            event("later", "2026-11-06T15:30:00Z", { body: "x".repeat(500) }),
            event("earlier", "2026-11-06T09:05:00Z"),
          ]
        : "summary:recap-2026-11-06",
    );
    fixture.model.mockResolvedValue({
      markdown: "A day.",
      topics: ["t"],
      threads: [{ title: "Reading", from: "09:00", to: "10:00" }],
      next: [],
    });
    const result = await localMemory.daySummary({ date: "2026-11-06", time_zone: "UTC" });
    expect(result).toEqual({ markdown: "A day.", topics: ["t"], count: 2 });
    const body = fixture.model.mock.calls[0][1];
    expect(fixture.model.mock.calls[0][0]).toBe("day-summary");
    expect(body.items.map((item: { title: string }) => item.title)).toEqual(["earlier", "later"]);
    expect(body.items[0].at).toBe("09:05");
    expect(body.items[1].excerpt).toHaveLength(400);
    const saved = fixture.invoke.mock.calls.find(([command]) => command === "memory_recap_save");
    expect(saved?.[1].recap).toMatchObject({
      date: "2026-11-06",
      markdown: "A day.",
      outline: { threads: [{ title: "Reading" }], next: [] },
    });
  });

  it("calls no model for a day with no moments, and shows a recap it couldn't keep", async () => {
    fixture.invoke.mockResolvedValue([]);
    await expect(localMemory.daySummary({ date: "2026-11-06", time_zone: "UTC" })).resolves.toEqual(
      {
        markdown: "",
        topics: [],
        count: 0,
      },
    );
    expect(fixture.model).not.toHaveBeenCalled();
    fixture.invoke.mockImplementation(async (command: string) => {
      if (command === "memory_events") return [event("a", "2026-11-06T09:05:00Z")];
      throw "memory_unavailable";
    });
    fixture.model.mockResolvedValue({ markdown: "A day.", topics: [], threads: [], next: [] });
    const shown = await localMemory.daySummary({ date: "2026-11-06", time_zone: "UTC" });
    expect(shown.markdown).toBe("A day.");
  });

  it("knows whether a day has its recap", async () => {
    fixture.invoke.mockResolvedValue([{ id: "summary:recap-2026-11-06" }]);
    await expect(localMemory.hasRecap("2026-11-06")).resolves.toBe(true);
    await expect(localMemory.hasRecap("2026-11-05")).resolves.toBe(false);
  });
});
