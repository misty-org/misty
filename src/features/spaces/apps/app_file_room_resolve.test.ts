import { webcrypto } from "node:crypto";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { Observable } from "lib0/observable";
import * as syncProtocol from "y-protocols/sync";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { pausedEdits } from "./app_file_room_copies";
import { FILE_META, fileRoomOpener, fingerprintOf, snapshotOf } from "./app_file_rooms";

const ui = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("@misty/ui", () => ({ notify: (...args: unknown[]) => ui.notify(...args) }));

const hooks = vi.hoisted(() => ({
  format: "app" as "app" | "text",
  create: null as unknown as (doc: unknown) => unknown,
}));

const drive = vi.hoisted(() => ({
  entry: null as Record<string, unknown> | null,
  read: null as unknown as (...args: unknown[]) => Promise<ArrayBuffer>,
  write: null as unknown as (...args: unknown[]) => Promise<unknown>,
  changed: new Set<(changed: unknown) => void>(),
}));

vi.mock("../journal/notes/create_yjs_provider", () => ({
  createYjsProvider: (_initial: unknown, doc: unknown) => hooks.create(doc),
  firstCollaborationTicket: (fetch: () => Promise<unknown>) => fetch(),
  requestCollaborationTicket: async () => ({
    ticket: "ticket",
    room: "room",
    url: "https://collab.test",
    format: hooks.format,
  }),
  withTimeout: (promise: Promise<unknown>) => promise,
}));

vi.mock("../drive/drive_native", () => ({
  driveEntryById: async () => drive.entry,
  driveNative: {
    read: (...args: unknown[]) => drive.read(...args),
    write: (...args: unknown[]) => drive.write(...args),
  },
  driveParent: (path: string) => path.slice(0, path.lastIndexOf("/")) || "/",
  onDriveChanged: (listener: (changed: unknown) => void) => {
    drive.changed.add(listener);
    return () => drive.changed.delete(listener);
  },
}));

vi.mock("../drive/drive_app_files", () => ({
  conflictedCopyName: (name: string) => `${name} (conflicted copy)`,
  driveFileRef: (entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name }),
  driveHostError: (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
}));

vi.mock("./app_file_room_server_contents", () => ({
  serverContents: () => ({ entry: async (entry: unknown) => entry, events: (listener: unknown) => listener }),
}));

class FakeProvider extends Observable<string> {
  awareness: Awareness;
  synced = false;
  wsconnected = false;
  ws: { readyState: number; send: (data: unknown) => void } | null = null;
  messageHandlers: unknown[] = [() => {}];
  _updateHandler = (_update: Uint8Array, _origin: unknown) => {};
  _awarenessUpdateHandler = () => {};
  sent: Record<string, unknown>[] = [];

  constructor(readonly doc: Y.Doc) {
    super();
    this.awareness = new Awareness(doc);
    const timed = this.awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> };
    clearInterval(timed._checkInterval);
    doc.on("update", this._updateHandler);
  }

  sendMessage(message: string) {
    this.sent.push(JSON.parse(message) as Record<string, unknown>);
  }

  destroy() {}

  disconnect() {
    this.down();
  }

  up() {
    this.wsconnected = true;
    this.ws = { readyState: WebSocket.OPEN, send: () => {} };
    this.emit("status", [{ status: "connected" }]);
    this.synced = true;
    this.emit("sync", [true]);
  }

  down() {
    this.emit("connection-close", [null]);
    this.wsconnected = false;
    this.ws = null;
    this.synced = false;
    this.emit("sync", [false]);
    this.emit("status", [{ status: "disconnected" }]);
  }

  say(message: Record<string, unknown>) {
    this.emit("custom-message", [JSON.stringify(message)]);
  }
}

const providers: FakeProvider[] = [];

hooks.create = (doc) => {
  const provider = new FakeProvider(doc as Y.Doc);
  providers.push(provider);
  return {
    provider,
    access: {
      lost: null,
      problem: null,
      subscribe: () => () => {},
      onProblem: () => () => {},
      lose: () => {},
      retry: () => {},
    },
  };
};

const flush = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

async function open(format: "app" | "text" = "app") {
  hooks.format = format;
  const events: Record<string, unknown>[] = [];
  const failures: unknown[] = [];
  const session = await fileRoomOpener("space-1", "app", { hold: async () => () => {} })(
    "file-1",
    { gc: true },
    (event) => events.push(event as Record<string, unknown>),
    (error) => failures.push(error),
  );
  const provider = providers.at(-1)!;
  provider.up();
  session.started();
  return { session, provider, events, failures, doc: provider.doc };
}

const of = (events: Record<string, unknown>[], type: string) =>
  events.filter((event) => event.type === type);

const loadInto = (doc: Y.Doc, version: number) =>
  doc.transact(() => {
    doc.getMap("content").set("value", 1);
    doc.getMap(FILE_META).set("loaded", version);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("crypto", webcrypto);
  providers.length = 0;
  drive.changed.clear();
  drive.entry = {
    id: "file-1",
    name: "a.bin",
    path: "/a.bin",
    kind: "file",
    version: 5,
    mtime_ms: 100,
    state: "downloaded",
  };
  drive.read = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
  drive.write = vi.fn(async () => ({ ...drive.entry }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const lateEdit = (key: string) => {
  const late = new Y.Doc();
  late.getMap(key).set("value", 1);
  return Y.encodeStateAsUpdate(late);
};

const askResend = (provider: FakeProvider) => {
  const asked = encoding.createEncoder();
  syncProtocol.writeSyncStep1(asked, new Y.Doc());
  const handler = provider.messageHandlers[0] as (...args: unknown[]) => void;
  handler(encoding.createEncoder(), decoding.createDecoder(encoding.toUint8Array(asked)), provider, true, 0);
};

const dirtyOutside = async (session: Awaited<ReturnType<typeof open>>) => {
  const { provider, doc } = session;
  provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
  loadInto(doc, 5);
  doc.getMap("content").set("value", 7);
  for (const listener of drive.changed)
    listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
  await vi.advanceTimersByTimeAsync(10_000);
};

describe("file rooms while the server keeps a changed file's content", () => {
  it("holds the app's edits while the server answers, and puts them in once it declines", async () => {
    const opened = await open();
    const { session, provider, doc } = opened;
    await dirtyOutside(opened);
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 8 });
    expect(session.admit(lateEdit("late"))).toBe(false);
    expect(doc.getMap("late").get("value")).toBeUndefined();
    provider.say({ type: "file_resolve_declined", version: 8 });
    expect(doc.getMap("late").get("value")).toBe(1);
    expect(session.admit(lateEdit("later"))).toBe(true);
    session.close();
  });

  it("puts held edits in when the server never answers within its bound", async () => {
    const opened = await open();
    const { session, doc } = opened;
    await dirtyOutside(opened);
    expect(session.admit(lateEdit("late"))).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(doc.getMap("late").get("value")).toBe(1);
    session.close();
  });

  it("pauses another copy's edits while the room is kept, and gives up within a bound", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.say({ type: "file_resolving", version: 8 });
    expect(of(events, "problem").at(-1)).toMatchObject({
      code: "stalled",
      message: "Keeping the changes beside the file, edits pause for a moment.",
    });
    expect(session.admit(lateEdit("late"))).toBe(false);
    await vi.advanceTimersByTimeAsync(75_000);
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "save_failed" });
    expect(doc.getMap("late").get("value")).toBe(1);
    expect(of(events, "serialize")).toHaveLength(0);
    session.close();
  });

  it("lets edits through again when the server stops keeping the room without opening it afresh", async () => {
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1", resolving: 8 });
    expect(session.admit(lateEdit("late"))).toBe(false);
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    expect(doc.getMap("late").get("value")).toBe(1);
    expect(session.admit(lateEdit("later"))).toBe(true);
    session.close();
  });

  it("keeps the room's content as the writer it was handed while the room is kept", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1", resolving: 8 });
    expect(of(events, "serialize")).toHaveLength(0);
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true, generation: "g1", resolving: 8 });
    const kept = of(events, "serialize").at(-1);
    expect(kept).toBeDefined();
    await session.serialized(kept!.request as number, new Uint8Array([7]));
    await vi.waitFor(() =>
      expect(provider.sent).toContainEqual(expect.objectContaining({ type: "file_reload", kept: true, version: 8 })),
    );
    expect(drive.write).toHaveBeenCalledTimes(1);
    session.close();
  });

  it("sends its kept copy again once it is back, without keeping a second one", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const opened = await open();
    const { session, provider, events } = opened;
    await dirtyOutside(opened);
    provider.say({ type: "file_resolving", version: 8 });
    const kept = of(events, "serialize").at(-1);
    await session.serialized(kept!.request as number, new Uint8Array([7]));
    await vi.waitFor(() => expect(provider.sent.filter((message) => message.kept === true)).toHaveLength(1));
    provider.down();
    provider.up();
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true, generation: "g1", base: 5, resolving: 8 });
    await vi.waitFor(() => expect(provider.sent.filter((message) => message.kept === true)).toHaveLength(2));
    expect(drive.write).toHaveBeenCalledTimes(1);
    session.close();
  });

  it("keeps a text room's edits made while it was paused beside the file when the server kept its text", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const { session, provider, events, failures, doc } = await open("text");
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    provider.say({ type: "file_resolving", version: 8 });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getText("text").insert(5, " paused");
    expect(session.admit(Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)))).toBe(false);
    const fingerprint = await fingerprintOf(snapshotOf(doc));
    provider.say({
      type: "file_writer",
      writer: false,
      dirty: false,
      loaded: false,
      generation: "g2",
      kept: true,
      fingerprint,
      kept_name: "a (conflicted copy).bin",
    });
    await vi.waitFor(() => expect(failures).toEqual([expect.objectContaining({ code: "closed" })]));
    expect(drive.write).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(vi.mocked(drive.write).mock.calls[0]![3] as Uint8Array)).toBe("hello paused");
    expect(of(events, "problem").at(-1)).toMatchObject({
      code: "reloaded",
      message: expect.stringContaining("Your changes were kept in a (conflicted copy).bin;"),
    });
    session.close();
  });

  it("closes a text room the server kept without a copy when nothing here was left unsent", async () => {
    const { session, provider, failures, doc } = await open("text");
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    doc.getText("text").insert(5, "!");
    provider.say({ type: "file_resolving", version: 8 });
    const fingerprint = await fingerprintOf(snapshotOf(doc));
    provider.say({ type: "file_writer", writer: false, loaded: false, generation: "g2", kept: true, fingerprint });
    await vi.waitFor(() => expect(failures).toEqual([expect.objectContaining({ code: "closed" })]));
    expect(drive.write).not.toHaveBeenCalled();
    session.close();
  });

  it("tells someone who can only read a changed file to open it again, without talk of their edits", async () => {
    const { session, provider, events, doc } = await open("text");
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    provider.say({
      type: "file_writer",
      writer: false,
      dirty: true,
      loaded: true,
      generation: "g1",
      read_only: true,
      has_writer: false,
      outside: true,
    });
    expect(of(events, "problem").at(-1)).toMatchObject({
      code: "save_failed",
      message: "This file was changed somewhere else. Open it again to see the newer version.",
    });
    session.close();
  });

  it("never takes the version the document marks as saved for its base, only the server's", async () => {
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    doc.transact(() => doc.getMap(FILE_META).set("saved", 8));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 8 });
    session.close();
  });

  it("sends everything again once a freeze it saw after saves stopped ends", async () => {
    const { session, provider, doc } = await open();
    const resent: unknown[] = [];
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.say({ type: "file_outside" });
    provider.ws = { readyState: WebSocket.OPEN, send: (data) => resent.push(data) };
    provider.say({ type: "file_resolving", version: 8 });
    expect(session.admit(lateEdit("late"))).toBe(true);
    expect(resent).toHaveLength(0);
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    expect(resent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resent).toHaveLength(1);
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resent).toHaveLength(1);
    session.close();
  });

  it("leaves sending edits again to the server's own ask once a freeze ends", async () => {
    const { session, provider, doc } = await open();
    const resent: unknown[] = [];
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.say({ type: "file_outside" });
    provider.ws = { readyState: WebSocket.OPEN, send: (data) => resent.push(data) };
    provider.say({ type: "file_resolving", version: 8 });
    askResend(provider);
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resent).toHaveLength(0);
    session.close();
  });

  it("waits for the server's ask after a paused room is let go, and sends everything only if none comes", async () => {
    const { session, provider, doc } = await open();
    const resent: unknown[] = [];
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.ws = { readyState: WebSocket.OPEN, send: (data) => resent.push(data) };
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1", resolving: 8 });
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(resent).toHaveLength(0);
    askResend(provider);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resent).toHaveLength(0);
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1", resolving: 9 });
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resent).toHaveLength(1);
    session.close();
  });

  it("takes the copy another writer kept for this version instead of keeping a second one", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    const fingerprint = await fingerprintOf(snapshotOf(doc));
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1", resolving: 8 });
    provider.say({
      type: "file_writer",
      writer: true,
      dirty: true,
      loaded: true,
      generation: "g1",
      resolving: 8,
      kept_name: "a (conflicted copy).bin",
      kept_fingerprint: fingerprint,
    });
    await vi.waitFor(() =>
      expect(provider.sent).toContainEqual({
        type: "file_reload",
        version: 8,
        kept: true,
        fingerprint,
        kept_name: "a (conflicted copy).bin",
      }),
    );
    expect(of(events, "serialize")).toHaveLength(0);
    expect(drive.write).not.toHaveBeenCalled();
    session.close();
  });

  it("tells the server and the person about a copy that was written after the pause had ended", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const opened = await open();
    const { session, provider, events } = opened;
    await dirtyOutside(opened);
    provider.say({ type: "file_resolving", version: 8 });
    const kept = of(events, "serialize").at(-1);
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true, generation: "g1", base: 8 });
    await session.serialized(kept!.request as number, new Uint8Array([7]));
    await vi.waitFor(() =>
      expect(ui.notify).toHaveBeenCalledWith({ message: "Your changes were also kept in a.bin (conflicted copy)." }),
    );
    expect(provider.sent).toContainEqual(
      expect.objectContaining({ type: "file_kept", version: 8, kept_name: "a.bin (conflicted copy)" }),
    );
    expect(provider.sent.some((message) => message.type === "file_reload" && message.kept === true)).toBe(false);
    session.close();
  });

  it("holds an edit that is sent again while paused only once", () => {
    const paused = pausedEdits();
    const edit = lateEdit("late");
    paused.push(edit);
    paused.push(edit);
    expect(paused.count).toBe(1);
    paused.push(lateEdit("other"));
    expect(paused.count).toBe(2);
    const doc = new Y.Doc();
    paused.replay(doc);
    expect(doc.getMap("late").get("value")).toBe(1);
    expect(doc.getMap("other").get("value")).toBe(1);
    expect(paused.count).toBe(0);
  });

  it("leaves a clean room's newer version to the new writer once it lost the writer", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 8 });
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, generation: "g1", base: 5 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent.some((message) => message.type === "file_resolve")).toBe(false);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });
});

describe("file rooms guarding their own marks", () => {
  it("opens the file afresh when the app marks it loaded from a version it wasn't handed", async () => {
    const { session, provider, events, failures } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false, generation: "g1" });
    await flush();
    expect(of(events, "load")).toEqual([expect.objectContaining({ version: 5 })]);
    const app = new Y.Doc();
    app.transact(() => {
      app.getMap("content").set("value", 1);
      app.getMap(FILE_META).set("loaded", 4);
    });
    expect(session.admit(Y.encodeStateAsUpdate(app))).toBe(false);
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "reloaded" });
    expect(failures).toEqual([expect.objectContaining({ code: "closed" })]);
    session.close();
  });

  it("never lets an app mark a text file as loaded", async () => {
    const { session, provider, failures, doc } = await open("text");
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    const app = new Y.Doc();
    app.getMap(FILE_META).set("loaded", 5);
    expect(session.admit(Y.encodeStateAsUpdate(app))).toBe(false);
    const edit = new Y.Doc();
    Y.applyUpdate(edit, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(edit);
    edit.getText("text").insert(5, "!");
    expect(session.admit(Y.encodeStateAsUpdate(edit, before))).toBe(true);
    expect(failures).toHaveLength(0);
    session.close();
  });

  it("refuses an app's write over an older value of the room's marks", async () => {
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    doc.getMap(FILE_META).set("saved", 5);
    const app = new Y.Doc();
    Y.applyUpdate(app, Y.encodeStateAsUpdate(doc));
    doc.getMap(FILE_META).set("saved", 6);
    const before = Y.encodeStateVector(app);
    app.getMap(FILE_META).set("saved", 99);
    expect(session.admit(Y.encodeStateAsUpdate(app, before))).toBe(false);
    session.close();
  });

  it("takes a rename of the file for what it is, not a change made somewhere else", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 3, name: "b.bin", path: "/b.bin" }] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent.some((message) => message.type === "file_reload" || message.type === "file_resolve")).toBe(false);
    expect(of(events, "problem")).toHaveLength(0);
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1_500);
    const asked = of(events, "serialize").at(-1);
    expect(asked).toBeDefined();
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 5 });
    session.close();
  });

  it("still takes a same-sized change that kept the file's name as made somewhere else", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 3, mtime_ms: 300 }] });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 6 });
    session.close();
  });

  it("tells the room about a rename, so every copy counts it as known", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 3, name: "b.bin", path: "/b.bin" }] });
    expect(provider.sent).toContainEqual({ type: "file_saved", renamed: 6 });
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5, renamed: 6 });
    provider.down();
    provider.up();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5, renamed: 6 });
    expect(provider.sent.filter((message) => message.type === "file_saved" && message.renamed === 6)).toHaveLength(1);
    expect(provider.sent.some((message) => message.type === "file_saved" && message.version !== undefined)).toBe(false);
    session.close();
  });

  it("counts a rename it never saw as known once the room says so, and still saves from the content's version", async () => {
    drive.entry = { ...drive.entry!, version: 6, name: "b.bin", path: "/b.bin" };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5, renamed: 6 });
    loadInto(doc, 5);
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5, renamed: 6 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent.some((message) => message.type === "file_reload" || message.type === "file_resolve")).toBe(false);
    expect(of(events, "problem")).toHaveLength(0);
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1_500);
    const asked = of(events, "serialize").at(-1);
    expect(asked).toBeDefined();
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 5 });
    session.close();
  });

  it("takes a text room's rename that lands before the worker's save is announced", async () => {
    drive.entry = { ...drive.entry!, name: "a.md", path: "/a.md", size: 5 };
    const { session, provider, events, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 11 }] });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 7, size: 11, name: "b.md", path: "/b.md" }] });
    expect(provider.sent.some((message) => message.type === "file_saved")).toBe(false);
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 6 });
    expect(provider.sent).toContainEqual({ type: "file_saved", renamed: 7 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string))).toBe(
      false,
    );
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("still takes a text room's change for outside once a rename follows it and the base never catches up", async () => {
    drive.entry = { ...drive.entry!, name: "a.md", path: "/a.md", size: 5 };
    const { session, provider, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 11 }] });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 7, size: 11, name: "b.md", path: "/b.md" }] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 6 });
    expect(provider.sent.some((message) => message.type === "file_saved")).toBe(false);
    session.close();
  });

  it("takes a rename that follows its own save once the save has settled", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 1, mtime_ms: 200 }] });
    expect(doc.getMap(FILE_META).get("saved")).toBe(6);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 7, size: 1, mtime_ms: 200, name: "b.bin", path: "/b.bin" }] });
    expect(provider.sent).toContainEqual({ type: "file_saved", renamed: 7 });
    await vi.waitFor(() =>
      expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(true),
    );
    expect(provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string))).toBe(
      false,
    );
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("keeps its save waiting for its own version when a rename lands while it uploads", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    const renamed = { ...drive.entry, version: 6, size: 1, mtime_ms: 200, name: "b.bin", path: "/b.bin" };
    for (const listener of drive.changed) listener({ space_id: "space-1", items: [{ ...renamed, state: "uploading" }] });
    expect(doc.getMap(FILE_META).get("saved")).toBeUndefined();
    for (const listener of drive.changed) listener({ space_id: "space-1", items: [{ ...renamed, version: 7 }] });
    expect(doc.getMap(FILE_META).get("saved")).toBe(7);
    expect(provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string))).toBe(
      false,
    );
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("confirms its own save over a file renamed before it opened", async () => {
    drive.entry = { ...drive.entry!, version: 6, size: 3, name: "b.bin", path: "/b.bin" };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5, renamed: 6 });
    loadInto(doc, 5);
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5, renamed: 6 });
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const asked = of(events, "serialize").at(-1);
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 5 });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 7, size: 1, mtime_ms: 200 }] });
    expect(doc.getMap(FILE_META).get("saved")).toBe(7);
    await vi.waitFor(() =>
      expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 7)).toBe(true),
    );
    expect(provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string))).toBe(
      false,
    );
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("takes a rename made on this computer, named at its old version first, for a rename", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, name: "b.bin", path: "/b.bin" }] });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, name: "b.bin", path: "/b.bin" }] });
    expect(provider.sent).toContainEqual({ type: "file_saved", renamed: 6 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string))).toBe(
      false,
    );
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("confirms its own save over a file renamed on this computer", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    const renamed = { ...drive.entry, name: "b.bin", path: "/b.bin" };
    for (const listener of drive.changed) listener({ space_id: "space-1", items: [renamed] });
    for (const listener of drive.changed) listener({ space_id: "space-1", items: [{ ...renamed, version: 6 }] });
    drive.write = vi.fn(async () => ({ ...renamed, version: 6, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const asked = of(events, "serialize").at(-1);
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...renamed, version: 7, size: 1, mtime_ms: 200 }] });
    expect(doc.getMap(FILE_META).get("saved")).toBe(7);
    await vi.waitFor(() =>
      expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 7)).toBe(true),
    );
    expect(provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string))).toBe(
      false,
    );
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("confirms its own save that settles at the next version, never taking it for a rename", async () => {
    drive.entry = { ...drive.entry!, size: 1 };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, mtime_ms: 200 }] });
    expect(doc.getMap(FILE_META).get("saved")).toBe(6);
    await vi.waitFor(() =>
      expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(true),
    );
    expect(provider.sent.some((message) => message.type === "file_saved" && message.renamed !== undefined)).toBe(false);
    expect(provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string))).toBe(
      false,
    );
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("takes a same-sized change at another time over its own save for one made somewhere else", async () => {
    drive.entry = { ...drive.entry!, size: 1 };
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, mtime_ms: 300 }] });
    expect(doc.getMap(FILE_META).get("saved")).toBeUndefined();
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 6 });
    session.close();
  });

  it("takes an edit made on this computer outside the app for a change made somewhere else, not a rename", async () => {
    drive.entry = { ...drive.entry!, size: 3 };
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, mtime_ms: 300, state: "uploading" }] });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, mtime_ms: 300 }] });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 6 });
    expect(provider.sent.some((message) => message.type === "file_saved" && message.renamed !== undefined)).toBe(false);
    session.close();
  });

  it("says once when it refuses an app's write to the room's own marks", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    for (const value of [98, 99]) {
      const app = new Y.Doc();
      Y.applyUpdate(app, Y.encodeStateAsUpdate(doc));
      const before = Y.encodeStateVector(app);
      app.getMap(FILE_META).set("saved", value);
      expect(session.admit(Y.encodeStateAsUpdate(app, before))).toBe(false);
    }
    expect(of(events, "problem").filter((event) => event.code === "stalled")).toHaveLength(1);
    session.close();
  });

  it("refuses an app's write nested under the room's marks", async () => {
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    doc.getMap(FILE_META).set("note", new Y.Map<unknown>());
    const app = new Y.Doc();
    Y.applyUpdate(app, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(app);
    (app.getMap(FILE_META).get("note") as Y.Map<unknown>).set("value", 1);
    expect(session.admit(Y.encodeStateAsUpdate(app, before))).toBe(false);
    session.close();
  });
});
