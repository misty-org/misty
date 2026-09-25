import { describe, expect, it, vi } from "vitest";
import { createMistyAppSDK, defineComponentApp } from "@misty/sdk";

describe("component SDK", () => {
  it("constructs independent clients without a Window, iframe, or Host global", async () => {
    const note = (id: string) => ({
      id,
      space_id: "space-a",
      creator_user_id: "user-a",
      title: "Notes",
      lifecycle_state: "active",
      collaboration_revision: 0,
      acl_version: 1,
      audience_kind: "space",
      created_at: "2026-09-04T00:00:00Z",
      updated_at: "2026-09-04T00:00:00Z",
      role: "creator",
      can_delete: true,
      backlink_count: 0,
    });
    const first = vi.fn(async ({ method }: { method: string }) =>
      method === "notes.list" ? { notes: [note("first")] } : note("first"),
    );
    const second = vi.fn(async ({ method }: { method: string }) =>
      method === "notes.list"
        ? { notes: [note("second")] }
        : {
            ticket: "scoped-ticket",
            room: "drawing-a",
            url: "wss://collab.example",
            role: "editor",
            expires_at: "2026-09-04T00:01:00Z",
          },
    );
    const a = createMistyAppSDK({ request: first });
    const b = createMistyAppSDK({ request: second });
    expect((await a.notes.list())[0].id).toBe("first");
    expect((await b.notes.list())[0].id).toBe("second");
    await a.notes.update("note-a", { shared_tags: ["work"] });
    expect(first).toHaveBeenLastCalledWith({
      method: "notes.update",
      params: { path: { noteID: "note-a" }, body: { shared_tags: ["work"] } },
    });
    await b.collaboration.createTicket("drawing", "drawing-a");
    expect(second).toHaveBeenLastCalledWith({
      method: "drawings.collaboration.ticket",
      params: { path: { drawingID: "drawing-a" } },
    });
  });

  it("exports an inert definition and lets the Host supply the SDK at mount time", async () => {
    const mount = vi.fn(() => ({ update: vi.fn(), unmount: vi.fn() }));
    const definition = defineComponentApp({
      appId: "planner",
      protocol: 2,
      mount,
    });
    expect(Object.isFrozen(definition)).toBe(true);
    expect(mount).not.toHaveBeenCalled();
    const misty = createMistyAppSDK({ request: async () => undefined });
    const context = {
      instanceId: "tab-a",
      route: "/apps/planner",
      active: true,
      appearance: { mode: "dark" as const },
    };
    const root = {} as HTMLElement;
    const instance = await definition.mount({ root, misty, context });
    expect(mount).toHaveBeenCalledWith({ root, misty, context });
    instance.update({ ...context, active: false });
    await instance.unmount();
    expect(instance.unmount).toHaveBeenCalledOnce();
  });
});
