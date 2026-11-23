import { createMisty, type Misty } from "@misty/sdk";
import * as encoding from "lib0/encoding";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  createAppRooms,
  ROOM_STALL_MS,
  type HostRoom,
  type RoomProblem,
  type RoomSource,
} from "./app_rooms";
import { createHostChannel, type FrameTarget, type HostHandlers } from "./host_channel";
import { HostError } from "./protocol";

vi.mock("../api/api", () => ({ spaceRequest: vi.fn() }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

const REMOTE = "remote";

const quiet = (awareness: Awareness) => {
  const timed = awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> };
  clearInterval(timed._checkInterval);
  awareness.setLocalState(null);
  return awareness;
};

function serverRoom() {
  const doc = new Y.Doc();
  const awareness = quiet(new Awareness(doc));
  const remote = quiet(new Awareness(new Y.Doc()));
  const controlled = new Set<number>();
  const sent: number[][] = [];
  let up = true;
  let lost: "deleted" | "revoked" | null = null;
  const listeners = new Set<() => void>();
  const connection = new Set<(connected: boolean) => void>();
  const problems = new Set<(problem: RoomProblem) => void>();
  let release!: () => void;
  const forward = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === REMOTE || !up) return;
    const changed = [...added, ...updated, ...removed];
    for (const client of changed) controlled.add(client);
    sent.push(changed);
    applyAwarenessUpdate(remote, encodeAwarenessUpdate(awareness, changed), REMOTE);
  };
  awareness.on("change", forward);
  const room: HostRoom & {
    lose(reason: "deleted" | "revoked"): void;
    sync(): void;
    drop(): void;
    reconnect(): void;
    problem(problem: RoomProblem): void;
    other(state: Record<string, unknown>): Awareness;
    closed: boolean;
    remote: Awareness;
    sent: number[][];
  } = {
    doc,
    awareness,
    remote,
    sent,
    synced: new Promise<void>((resolve) => (release = resolve)),
    lost: () => lost,
    onLost(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onConnection(listener) {
      connection.add(listener);
      return () => connection.delete(listener);
    },
    onProblem(listener) {
      problems.add(listener);
      return () => problems.delete(listener);
    },
    resend(clients) {
      if (!up) return;
      const states = awareness.getStates();
      const present = clients.filter((client) => states.has(client));
      if (present.length) forward({ added: [], updated: present, removed: [] }, null);
    },
    closed: false,
    close() {
      room.closed = true;
      awareness.off("change", forward);
    },
    lose(reason) {
      lost = reason;
      for (const listener of [...listeners]) listener();
    },
    sync: () => release(),
    drop() {
      up = false;
      const others = [...awareness.getStates().keys()].filter((client) => client !== doc.clientID);
      removeAwarenessStates(awareness, others, REMOTE);
      for (const client of others) awareness.meta.delete(client);
      const gone = [...controlled].filter((client) => remote.getStates().has(client));
      if (gone.length) removeAwarenessStates(remote, gone, REMOTE);
      controlled.clear();
      for (const listener of [...connection]) listener(false);
    },
    reconnect() {
      up = true;
      for (const listener of [...connection]) listener(true);
    },
    problem(problem) {
      for (const listener of [...problems]) listener(problem);
    },
    other(state) {
      const someone = new Awareness(new Y.Doc());
      quiet(someone).setLocalState(state);
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(someone, [someone.clientID]), REMOTE);
      return someone;
    },
  };
  return room;
}

const identity = { user_id: "u1", name: "Ada", tone: "blue" };

function client(source: RoomSource, syncs = false): Misty {
  const rooms = createAppRooms("space-1", "code", { identity, source });
  const handlers: HostHandlers = {
    call: async (method, params) => {
      const call = rooms.calls[method as keyof typeof rooms.calls];
      if (!call) throw new Error(method);
      return call(params as Record<string, unknown>);
    },
    subscribe: (_topic, params, emit, end) =>
      rooms.subscribe(params as Record<string, unknown>, emit, end),
  };
  const handed: { port?: MessagePort } = {};
  const frame: FrameTarget = {
    postMessage: (_message, _origin, transfer) => (handed.port = transfer[0] as MessagePort),
  };
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
      ...(syncs
        ? { offers: { calls: ["room.update", "room.awareness", "room.sync"], topics: ["room"] } }
        : {}),
    },
    { applyTheme: false },
  );
}

function direct(source: RoomSource) {
  const rooms = createAppRooms("space-1", "code", { identity, source });
  const events: Record<string, unknown>[] = [];
  const ends: unknown[] = [];
  const subscribe = (params: Record<string, unknown>) =>
    rooms.subscribe(
      params,
      (data) => events.push(data as Record<string, unknown>),
      (error) => ends.push(error),
    );
  return { rooms, events, ends, subscribe };
}

const awarenessUpdate = (client: number, clock: number, state: unknown) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, client);
  encoding.writeVarUint(encoder, clock);
  encoding.writeVarString(encoder, JSON.stringify(state));
  return encoding.toUint8Array(encoder);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createAppRooms through misty-sdk", () => {
  it("syncs both ways, keeping what the app wrote before the room opened", async () => {
    const server = serverRoom();
    server.doc.getText("t").insert(0, "server");
    const misty = client(async () => server);
    const room = misty.room("session-1", { gc: false });
    expect(room.doc.gc).toBe(false);
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
    const misty = client(async () => server);
    const room = misty.room("session-1");
    room.awareness.setLocalState({ user: { id: "u1", name: "Ada" } });
    server.sync();
    await room.synced;
    await settle();
    const other = server.other({ user: { id: "u2", name: "Ben" } });
    await settle();
    expect(server.awareness.getStates().get(room.awareness.clientID)).toEqual({
      user: { id: "u1", name: "Ada" },
      misty: identity,
    });
    expect(room.awareness.getStates().get(other.clientID)).toEqual({
      user: { id: "u2", name: "Ben" },
    });

    room.destroy();
    await settle();
    expect(server.awareness.getStates().has(room.awareness.clientID)).toBe(false);
    expect(server.remote.getStates().has(room.awareness.clientID)).toBe(false);
    expect(server.sent.flat()).not.toContain(other.clientID);
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

  it("says a room that moved on the server was replaced, so the app opens it again", async () => {
    const server = serverRoom();
    const moved = Object.assign(server, { moved: () => true });
    const misty = client(async () => moved);
    const room = misty.room("session-1");
    server.sync();
    await room.synced;
    const heard: string[] = [];
    room.onError((error) => heard.push(error.code));
    const lost: string[] = [];
    room.onLost((error) => lost.push(error.code));
    server.lose("deleted");
    await settle();
    expect(heard).toContain("reloaded");
    expect(lost).toHaveLength(1);
    expect(lost[0]).not.toBe("not_found");
    expect(server.closed).toBe(true);
    misty.close();
  });

  it("rejects `synced` when the room can't be opened for good", async () => {
    const misty = client(async () => {
      throw new HostError("permission_denied", "You no longer have access to this room.");
    });
    const room = misty.room("session-1");
    await expect(room.synced).rejects.toMatchObject({ code: "permission_denied" });
    expect(room.lost?.code).toBe("permission_denied");
    room.destroy();
    misty.close();
  });

  it("says a room couldn't be opened for a passing reason and keeps trying it", async () => {
    const misty = client(async () => {
      throw new Error("offline");
    });
    const room = misty.room("session-1");
    const heard: string[] = [];
    room.onError((error) => heard.push(error.code));
    await vi.waitFor(() => expect(heard).toContain("internal"));
    expect(room.lost).toBeNull();
    room.destroy();
    await expect(room.synced).rejects.toMatchObject({ code: "cancelled" });
    misty.close();
  });

  it("stamps Misty's identity over whatever the app claims, and drops states for others' clients", async () => {
    const server = serverRoom();
    const other = server.other({ misty: { user_id: "u2", name: "Ben", tone: "red" } });
    const misty = client(async () => server);
    const room = misty.room("session-1");
    server.sync();
    await room.synced;
    room.awareness.setLocalState({ misty: { user_id: "u2", name: "Ben", tone: "red" } });
    await settle();
    expect(server.awareness.getStates().get(room.awareness.clientID)).toEqual({ misty: identity });
    const forged = new Awareness(new Y.Doc());
    forged.clientID = other.clientID;
    forged.setLocalState({ misty: identity, taken: true });
    applyAwarenessUpdate(room.awareness, encodeAwarenessUpdate(forged, [other.clientID]), "test");
    await settle();
    expect(server.awareness.getStates().get(other.clientID)).toEqual({
      misty: { user_id: "u2", name: "Ben", tone: "red" },
    });
    room.destroy();
    misty.close();
  });

  it("heals by state vector when the app's SDK speaks room.sync", async () => {
    const server = serverRoom();
    server.doc.getText("t").insert(0, "server");
    const misty = client(async () => server, true);
    const room = misty.room("session-1");
    room.doc.getMap("m").set("early", 1);
    server.sync();
    await room.synced;
    await settle();
    expect(room.doc.getText("t").toString()).toBe("server");
    expect(server.doc.getMap("m").get("early")).toBe(1);
    room.destroy();
    misty.close();
  });

  it("puts the app's cursor back on the server once the link comes back", async () => {
    const server = serverRoom();
    const misty = client(async () => server);
    const room = misty.room("session-1");
    room.awareness.setLocalState({ cursor: 3 });
    server.sync();
    await room.synced;
    await settle();
    const mine = room.awareness.clientID;
    expect(server.remote.getStates().get(mine)).toEqual({ cursor: 3, misty: identity });

    server.drop();
    await settle();
    expect(server.remote.getStates().has(mine)).toBe(false);
    expect(room.awareness.getLocalState()).toEqual({ cursor: 3 });

    server.reconnect();
    await settle();
    expect(server.remote.getStates().get(mine)).toEqual({ cursor: 3, misty: identity });
    room.destroy();
    misty.close();
  });

  it("never sends other people's awareness back to the server", async () => {
    const server = serverRoom();
    const misty = client(async () => server);
    const room = misty.room("session-1");
    room.awareness.setLocalState({ cursor: 1 });
    server.sync();
    await room.synced;
    await settle();
    const other = server.other({ cursor: 9 });
    await settle();
    expect(room.awareness.getStates().get(other.clientID)).toEqual({ cursor: 9 });
    expect(server.sent.flat()).not.toContain(other.clientID);
    room.destroy();
    misty.close();
  });
});

describe("createAppRooms on its own", () => {
  it("says when the link drops and when it is back", async () => {
    const server = serverRoom();
    const { events, subscribe } = direct(async () => server);
    const leave = subscribe({ id: "session-1" });
    server.sync();
    await settle();
    server.drop();
    server.reconnect();
    await settle();
    expect(events.filter((event) => event.type === "connection")).toEqual([
      { type: "connection", connected: false },
      { type: "connection", connected: true },
    ]);
    leave();
  });

  it("gives the app's awareness its own clocks, whatever the app claims", async () => {
    const server = serverRoom();
    const { rooms, subscribe } = direct(async () => server);
    const leave = subscribe({ id: "session-1" });
    server.sync();
    await settle();
    await rooms.calls["room.awareness"]({
      id: "session-1",
      update: awarenessUpdate(4242, 2 ** 40, { cursor: 1 }),
    });
    expect(server.awareness.meta.get(4242)?.clock).toBe(1);
    expect(server.awareness.getStates().get(4242)).toEqual({ cursor: 1, misty: identity });
    leave();
  });

  it("refuses client ids that belong to someone else or to an earlier visit", async () => {
    const opened: ReturnType<typeof serverRoom>[] = [];
    const { rooms, subscribe } = direct(async () => {
      const server = serverRoom();
      opened.push(server);
      return server;
    });
    const first = subscribe({ id: "session-1" });
    opened[0]!.sync();
    await settle();
    const other = opened[0]!.other({ cursor: 5 });
    await rooms.calls["room.awareness"]({
      id: "session-1",
      update: awarenessUpdate(other.clientID, 99, { cursor: 0 }),
    });
    expect(opened[0]!.awareness.getStates().get(other.clientID)).toEqual({ cursor: 5 });
    await rooms.calls["room.awareness"]({
      id: "session-1",
      update: awarenessUpdate(777, 1, { cursor: 2 }),
    });
    first();
    expect(opened[0]!.remote.getStates().has(777)).toBe(false);

    const second = subscribe({ id: "session-1" });
    opened[1]!.sync();
    await settle();
    await rooms.calls["room.awareness"]({
      id: "session-1",
      update: awarenessUpdate(777, 3, { cursor: 2 }),
    });
    expect(opened[1]!.awareness.getStates().has(777)).toBe(false);
    second();
  });

  it("says a room is stalled when it hasn't synced in time, and keeps trying", () => {
    vi.useFakeTimers();
    const { events, ends, subscribe } = direct(() => new Promise<HostRoom>(() => {}));
    const leave = subscribe({ id: "session-1" });
    vi.advanceTimersByTime(ROOM_STALL_MS);
    expect(events).toContainEqual(expect.objectContaining({ type: "problem", code: "stalled" }));
    expect(ends).toEqual([]);
    leave();
  });

  it("doesn't call a room stalled once it stopped for being too large", async () => {
    vi.useFakeTimers();
    const server = serverRoom();
    const { events, subscribe } = direct(async () => server);
    const leave = subscribe({ id: "session-1" });
    server.sync();
    await vi.advanceTimersByTimeAsync(30);
    server.problem({ code: "too_large", message: "This room is bigger than the server takes." });
    server.drop();
    await vi.advanceTimersByTimeAsync(ROOM_STALL_MS * 2);
    expect(events).toContainEqual(expect.objectContaining({ type: "problem", code: "too_large" }));
    expect(events).not.toContainEqual(expect.objectContaining({ type: "problem", code: "stalled" }));
    leave();
  });

  it("refuses room ids made only of dots", () => {
    const { subscribe } = direct(async () => serverRoom());
    expect(() => subscribe({ id: ".." })).toThrow();
    expect(() => subscribe({ id: "." })).toThrow();
  });
});
