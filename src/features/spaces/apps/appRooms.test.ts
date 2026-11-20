import { createMisty, type Misty } from "@misty/sdk";
import { Awareness } from "y-protocols/awareness";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createAppRooms, type HostRoom, type RoomSource } from "./appRooms";
import { createHostChannel, type FrameTarget, type HostHandlers } from "./hostChannel";

vi.mock("../api/api", () => ({ spaceRequest: vi.fn() }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

/** A server room as the host would hold it: a doc and awareness of its own, lost on demand. */
function serverRoom() {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  let lost: "deleted" | "revoked" | null = null;
  const listeners = new Set<() => void>();
  let release!: () => void;
  const room: HostRoom & { lose(reason: "deleted" | "revoked"): void; sync(): void; closed: boolean } = {
    doc,
    awareness,
    synced: new Promise<void>((resolve) => (release = resolve)),
    lost: () => lost,
    onLost(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    closed: false,
    close() {
      room.closed = true;
    },
    lose(reason) {
      lost = reason;
      for (const listener of [...listeners]) listener();
    },
    sync: () => release(),
  };
  return room;
}

/** An SDK client in this window over the host channel, whose rooms come from `source`. */
function client(source: RoomSource): Misty {
  const rooms = createAppRooms("space-1", "code", source);
  const handlers: HostHandlers = {
    call: async (method, params) => {
      const call = rooms.calls[method as keyof typeof rooms.calls];
      if (!call) throw new Error(method);
      return call(params as Record<string, unknown>);
    },
    subscribe: (_topic, params, emit, end) => rooms.subscribe(params as Record<string, unknown>, emit, end),
  };
  const handed: { port?: MessagePort } = {};
  const frame: FrameTarget = { postMessage: (_message, _origin, transfer) => (handed.port = transfer[0] as MessagePort) };
  createHostChannel({ frame, authorize: async () => {}, handlers }).start();
  return createMisty(
    handed.port!,
    {
      app_id: "code",
      space: { id: "space-1", name: "Space", is_mod: false },
      me: { user_id: "u1", name: "Ada", role: "member" },
      theme: { mode: "dark", tokens: {}, fonts: { sans: "Inter", mono: "Menlo" } },
      route: { path: "/", params: {} },
      permissions: [],
    },
    { applyTheme: false },
  );
}

describe("createAppRooms through misty-sdk", () => {
  it("syncs both ways, keeping what the app wrote before the room opened", async () => {
    const server = serverRoom();
    server.doc.getText("t").insert(0, "server");
    const misty = client(async () => server);
    const room = misty.room("session-1", { gc: false });
    expect(room.doc.gc).toBe(false);
    // Written before the host's room is open: it waits, then lands.
    room.doc.getMap("m").set("early", 1);
    await settle();
    server.sync();
    await room.synced;
    await settle();
    expect(room.doc.getText("t").toString()).toBe("server");
    expect(server.doc.getMap("m").get("early")).toBe(1);

    room.doc.getText("t").insert(0, "app ");
    server.doc.getText("t").insert(server.doc.getText("t").length, " again");
    await settle();
    expect(server.doc.getText("t").toString()).toBe("app server again");
    expect(room.doc.getText("t").toString()).toBe("app server again");
    room.destroy();
    misty.close();
  });

  it("carries awareness both ways, and takes the app's own out when it leaves", async () => {
    const server = serverRoom();
    const other = new Awareness(new Y.Doc());
    other.setLocalState({ user: { id: "u2", name: "Ben" } });
    const misty = client(async () => server);
    const room = misty.room("session-1");
    room.awareness.setLocalState({ user: { id: "u1", name: "Ada" } });
    server.sync();
    await room.synced;
    await settle();
    // Another member arrives on the server's side.
    const { encodeAwarenessUpdate, applyAwarenessUpdate } = await import("y-protocols/awareness");
    applyAwarenessUpdate(server.awareness, encodeAwarenessUpdate(other, [other.clientID]), "server");
    await settle();
    expect(server.awareness.getStates().get(room.awareness.clientID)).toEqual({ user: { id: "u1", name: "Ada" } });
    expect(room.awareness.getStates().get(other.clientID)).toEqual({ user: { id: "u2", name: "Ben" } });

    room.destroy();
    await settle();
    expect(server.awareness.getStates().has(room.awareness.clientID)).toBe(false);
    expect(server.closed).toBe(true);
    misty.close();
  });

  it("says why a room stopped: deleted is not_found, and the host lets it go", async () => {
    const server = serverRoom();
    const misty = client(async () => server);
    const room = misty.room("session-1");
    server.sync();
    await room.synced;
    const heard: string[] = [];
    room.onLost((error) => heard.push(error.code));
    server.lose("deleted");
    await settle();
    expect(heard).toEqual(["not_found"]);
    expect(server.closed).toBe(true);
    misty.close();
  });

  it("rejects `synced` when the room can't be opened", async () => {
    const misty = client(async () => {
      throw new Error("offline");
    });
    const room = misty.room("session-1");
    await expect(room.synced).rejects.toMatchObject({ code: "internal" });
    room.destroy();
    misty.close();
  });
});
