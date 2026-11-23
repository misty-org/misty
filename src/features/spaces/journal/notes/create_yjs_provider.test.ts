import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const made = vi.hoisted(() => ({
  providers: [] as {
    options: { params: () => Promise<Record<string, string>> };
    handlers: Map<string, ((...args: unknown[]) => void)[]>;
    disconnect: ReturnType<typeof vi.fn>;
    shouldConnect: boolean;
  }[],
}));

vi.mock("@/api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(readonly status: number) {
      super("request failed");
    }
  },
  apiRequest: vi.fn(),
}));

vi.mock("y-partyserver/provider", () => ({
  default: class FakeYProvider {
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    shouldConnect = true;
    ws = null;
    disconnect = vi.fn();
    awareness = { on: vi.fn(), off: vi.fn() };
    _awarenessUpdateHandler = vi.fn();
    constructor(
      _host: string,
      _room: string,
      _doc: unknown,
      readonly options: { params: () => Promise<Record<string, string>> },
    ) {
      made.providers.push(this);
    }
    on(name: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }
    destroy() {}
    connect() {
      return Promise.resolve();
    }
  },
}));

import { createYjsProvider } from "./create_yjs_provider";

const ticket = { ticket: "t1", room: "room-a", url: "https://collab.test/parties/app-room/room-a" };

describe("createYjsProvider", () => {
  it("loses the room when a fresh ticket names a different room", async () => {
    const refresh = vi.fn(async () => ({ ...ticket, ticket: "t2", room: "room-b" }));
    const { access } = createYjsProvider(ticket, new Y.Doc(), "app-room", refresh);
    const provider = made.providers.at(-1)!;
    await expect(provider.options.params()).resolves.toEqual({ ticket: "t1" });
    await expect(provider.options.params()).rejects.toThrow();
    expect(access.lost).toBe("deleted");
    expect(access.moved).toBe(true);
  });

  it("keeps using a fresh ticket for the same room", async () => {
    const refresh = vi.fn(async () => ({ ...ticket, ticket: "t2" }));
    const { access } = createYjsProvider(ticket, new Y.Doc(), "app-room", refresh);
    const provider = made.providers.at(-1)!;
    await provider.options.params();
    await expect(provider.options.params()).resolves.toEqual({ ticket: "t2" });
    expect(access.lost).toBeNull();
  });

  it("stops for good when the server says the ticket is for another room", () => {
    const { access } = createYjsProvider(ticket, new Y.Doc(), "app-room", vi.fn());
    const provider = made.providers.at(-1)!;
    for (const handler of provider.handlers.get("connection-close") ?? [])
      handler({ code: 1008, reason: "ticket_room_mismatch" });
    expect(access.lost).toBe("deleted");
    expect(provider.disconnect).toHaveBeenCalled();
  });
});
