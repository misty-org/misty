import { webcrypto } from "node:crypto";
import { Observable } from "lib0/observable";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { FILE_META, fileRoomOpener, fingerprintOf, snapshotOf } from "./app_file_rooms";

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
    state: "downloaded",
  };
  drive.read = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
  drive.write = vi.fn(async () => ({ ...drive.entry }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("file rooms", () => {
  it("saves with the version the room was loaded from, not the drive's newest", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    expect(of(events, "load")).toEqual([expect.objectContaining({ version: 5 })]);
    loadInto(doc, 5);
    await vi.waitFor(() => expect(provider.sent.at(-1)?.type).toBe("file_saved"));

    drive.entry = { ...drive.entry!, version: 9 };
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    expect(asked).toBeDefined();
    const before = provider.sent.length;
    await session.serialized(asked!.request as number, new Uint8Array([9]));
    expect(drive.write).toHaveBeenCalledTimes(1);
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 5 });
    await vi.waitFor(() => expect(provider.sent.length).toBeGreaterThan(before));
    expect(provider.sent.at(-1)).toMatchObject({ type: "file_saved" });
    expect(typeof provider.sent.at(-1)?.fingerprint).toBe("string");
    session.close();
  });

  it("stops being the writer when the link drops, until the server says so again", async () => {
    const { session, provider, events } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    expect(of(events, "file").at(-1)).toMatchObject({ writer: true });
    provider.down();
    expect(of(events, "file").at(-1)).toMatchObject({ writer: false });
    provider.up();
    expect(of(events, "file").at(-1)).toMatchObject({ writer: false });
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    expect(of(events, "file").at(-1)).toMatchObject({ writer: true, loaded: true, editable: true });
    session.close();
  });

  it("doesn't write a save it was asked for once the link has dropped", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    doc.getMap("content").set("value", 3);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    provider.down();
    await session.serialized(asked!.request as number, new Uint8Array([1]));
    expect(drive.write).not.toHaveBeenCalled();
    session.close();
  });

  it("loads once while the app is still loading, and never when the server has it", async () => {
    const first = await open();
    first.provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    first.provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    first.provider.down();
    first.provider.up();
    first.provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    expect(of(first.events, "load")).toHaveLength(1);
    first.session.close();

    const second = await open();
    second.provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    await flush();
    expect(of(second.events, "load")).toHaveLength(0);
    second.session.close();
  });

  it("asks for one save at a time, and asks again for what came in meanwhile", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    let finish!: (entry: unknown) => void;
    drive.write = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    doc.getMap("content").set("value", 4);
    await vi.advanceTimersByTimeAsync(1500);
    expect(of(events, "serialize")).toHaveLength(1);
    const [asked] = of(events, "serialize");
    const saving = session.serialized(asked!.request as number, new Uint8Array([4]));
    await flush();
    doc.getMap("content").set("value", 5);
    await vi.advanceTimersByTimeAsync(1500);
    expect(of(events, "serialize")).toHaveLength(1);
    await session.serialized(asked!.request as number, new Uint8Array([4]));
    expect(drive.write).toHaveBeenCalledTimes(1);
    finish({ ...drive.entry });
    await saving;
    await vi.advanceTimersByTimeAsync(1500);
    expect(of(events, "serialize")).toHaveLength(2);
    session.close();
  });

  it("ends the room when the file is trashed", async () => {
    const { session, failures } = await open();
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, trashed: true }] });
    expect(failures).toEqual([expect.objectContaining({ code: "not_found" })]);
    session.close();
  });

  it("won't open a text file with Windows line endings as a live room", async () => {
    drive.read = vi.fn(async () => new TextEncoder().encode("one\r\ntwo").buffer);
    const { session, provider, failures, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    expect(failures).toEqual([expect.objectContaining({ code: "unsupported" })]);
    expect(doc.getText("text").toString()).toBe("");
    session.close();
  });

  it("reports a save only once the server has taken the new version", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    loadInto(doc, 5);
    await vi.waitFor(() => expect(provider.sent.at(-1)).toMatchObject({ type: "file_saved", version: 5 }));
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    const before = provider.sent.length;
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    await flush();
    expect(provider.sent.length).toBe(before);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "downloaded" }] });
    await vi.waitFor(() => expect(provider.sent.at(-1)).toMatchObject({ type: "file_saved", version: 6 }));
    expect(doc.getMap(FILE_META).get("saved")).toBe(6);
    session.close();
  });

  it("refuses an app's load once it isn't the writer, and opens the file afresh", async () => {
    const { session, provider, events, failures } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    expect(of(events, "load")).toHaveLength(1);
    const app = new Y.Doc();
    app.transact(() => {
      app.getMap("content").set("value", 1);
      app.getMap(FILE_META).set("loaded", 5);
    });
    const update = Y.encodeStateAsUpdate(app);
    expect(session.admit(new Uint8Array([0, 0]))).toBe(true);
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: false });
    expect(session.admit(update)).toBe(false);
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "reloaded" });
    expect(failures).toEqual([expect.objectContaining({ code: "closed" })]);
    session.close();
  });

  it("takes the writer's own load while it is still loading", async () => {
    const { session, provider } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    const app = new Y.Doc();
    app.getMap(FILE_META).set("loaded", 5);
    expect(session.admit(Y.encodeStateAsUpdate(app))).toBe(true);
    session.close();
  });

  it("says so when the app doesn't load the file, and asks it once more", async () => {
    const { session, provider, events } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    expect(of(events, "load")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "stalled" });
    expect(of(events, "load")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(of(events, "problem").filter((event) => event.code === "stalled")).toHaveLength(2);
    expect(of(events, "load")).toHaveLength(2);
    session.close();
  });

  it("asks the server to load a clean room afresh when the file changed somewhere else", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    loadInto(doc, 5);
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 8 });
    expect(of(events, "problem")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 8 });
    provider.say({ type: "file_resolving", version: 8 });
    const kept = of(events, "serialize").at(-1);
    expect(kept).toBeDefined();
    session.serializeFailed(kept!.request as number, "No.");
    await flush();
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "save_failed" });
    session.close();
  });

  it("pauses a dirty room, keeps its content beside the file, then has the room opened afresh from the drive", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const { session, provider, events, failures, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false, generation: "g1" });
    await flush();
    loadInto(doc, 5);
    doc.getMap("content").set("value", 7);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(provider.sent.some((message) => message.type === "file_resolve")).toBe(false);
    expect(of(events, "problem")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 8 });
    expect(of(events, "serialize")).toHaveLength(0);
    const late = new Y.Doc();
    late.getMap("late").set("value", 1);
    expect(session.admit(Y.encodeStateAsUpdate(late))).toBe(false);
    provider.say({ type: "file_resolving", version: 8 });
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "stalled" });
    const kept = of(events, "serialize").at(-1);
    expect(kept).toBeDefined();
    await session.serialized(kept!.request as number, new Uint8Array([7]));
    await vi.waitFor(() => expect(provider.sent.some((message) => message.type === "file_reload")).toBe(true));
    const [, , name, , options] = vi.mocked(drive.write).mock.calls[0]!;
    expect(name).toBe("a.bin (conflicted copy)");
    expect(options).toBeUndefined();
    const fingerprint = await fingerprintOf(snapshotOf(doc));
    expect(provider.sent).toContainEqual({
      type: "file_reload",
      version: 8,
      kept: true,
      fingerprint,
      kept_name: "a.bin (conflicted copy)",
    });
    provider.say({
      type: "file_writer",
      writer: false,
      dirty: false,
      loaded: false,
      generation: "g2",
      kept: true,
      fingerprint,
      kept_name: "a.bin (conflicted copy)",
    });
    await vi.waitFor(() => expect(failures).toEqual([expect.objectContaining({ code: "closed" })]));
    expect(drive.write).toHaveBeenCalledTimes(1);
    expect(of(events, "problem").at(-1)).toMatchObject({
      code: "reloaded",
      message: "Your changes were kept in a.bin (conflicted copy); the file now shows the newer version.",
    });
    session.close();
  });

  it("waits for a save another copy made before taking the drive's newer version for an outside change", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, base: 5 });
    loadInto(doc, 5);
    doc.getMap("content").set("value", 7);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true, base: 5 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(of(events, "serialize")).toHaveLength(0);
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true, base: 8 });
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    expect(asked).toBeDefined();
    await session.serialized(asked!.request as number, new Uint8Array([7]));
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 8 });
    session.close();
  });

  it("doesn't save an unchanged file when the writer is handed over", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true });
    loadInto(doc, 5);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    remote.getMap("content").set("value", 3);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), provider);
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true });
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(of(events, "serialize")).toHaveLength(0);
    session.close();
  });

  it("saves within a bound while edits keep coming", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    for (let tick = 0; tick < 11; tick += 1) {
      doc.getMap("content").set("value", tick);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(of(events, "serialize")).toHaveLength(1);
    session.close();
  });

  it("drops a read-only viewer's edits and says so once", async () => {
    const { session, provider, events } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, read_only: true });
    const app = new Y.Doc();
    app.getMap("content").set("value", 1);
    expect(session.admit(Y.encodeStateAsUpdate(app))).toBe(false);
    expect(session.admit(Y.encodeStateAsUpdate(app))).toBe(false);
    expect(of(events, "problem").filter((event) => event.code === "read_only")).toHaveLength(1);
    session.close();
  });

  it("opens the file afresh instead of pushing what it held when the server never says its generation", async () => {
    const { session, provider, events, failures } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    provider.down();
    provider.up();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "reloaded" });
    expect(failures).toEqual([expect.objectContaining({ code: "closed" })]);
    session.close();
  });

  it("saves over the version the server recorded, not one an app wrote into the document", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, base: 6 });
    loadInto(doc, 5);
    doc.getMap(FILE_META).set("saved", 99);
    doc.getMap("content").set("value", 8);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([8]));
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 6 });
    session.close();
  });

  it("confirms a save the drive took without a new version, so a later outside change isn't taken for it", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    await vi.waitFor(() => expect(provider.sent.at(-1)).toMatchObject({ type: "file_saved", version: 5 }));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8, size: 1, state: "downloaded" }] });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 8 });
    expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 8)).toBe(false);
    session.close();
  });

  it("doesn't take a different file for its own pending save", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 40, state: "downloaded" }] });
    expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(false);
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 6 });
    provider.say({ type: "file_resolving", version: 6 });
    expect(of(events, "serialize")).toHaveLength(2);
    session.close();
  });

  it("gives up the writer and tells the room when it can't keep the room's content beside a changed file", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    doc.getMap("content").set("value", 7);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    await vi.advanceTimersByTimeAsync(10_000);
    provider.say({ type: "file_resolving", version: 8 });
    const kept = of(events, "serialize").at(-1);
    session.serializeFailed(kept!.request as number, "No.");
    await flush();
    expect(provider.sent).toContainEqual({ type: "file_outside" });
    expect(provider.sent).toContainEqual({ type: "file_writer_release" });
    session.close();
  });

  it("says saves stopped when another copy says the file changed somewhere else, and won't keep the writer", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true });
    loadInto(doc, 5);
    provider.say({ type: "file_outside" });
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "save_failed" });
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true });
    expect(provider.sent).toContainEqual({ type: "file_writer_release" });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(of(events, "serialize")).toHaveLength(0);
    session.close();
  });

  it("answers the server's writer check while linked", async () => {
    const { session, provider } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true });
    provider.say({ type: "writer_check", nonce: "n1" });
    expect(provider.sent).toContainEqual({ type: "writer_ok", nonce: "n1" });
    provider.down();
    provider.say({ type: "writer_check", nonce: "n2" });
    expect(provider.sent).not.toContainEqual({ type: "writer_ok", nonce: "n2" });
    session.close();
  });

  it("checks a change made somewhere else again once it is linked, instead of giving up offline", async () => {
    const { session, provider, events, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    provider.down();
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(of(events, "problem").some((event) => event.code === "save_failed")).toBe(false);
    provider.up();
    expect(provider.sent).not.toContainEqual({ type: "file_reload", version: 8 });
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 8 });
    session.close();
  });

  it("says whether anyone in the room can load the file", async () => {
    const { session, provider, events } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: false, read_only: true, has_writer: false });
    expect(of(events, "file").at(-1)).toMatchObject({ has_writer: false, editable: false });
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: false, read_only: true, has_writer: true });
    expect(of(events, "file").at(-1)).toMatchObject({ has_writer: true });
    session.close();
  });

  it("refuses an app's update that deletes the room's file marks", async () => {
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    const app = new Y.Doc();
    Y.applyUpdate(app, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(app);
    app.getMap(FILE_META).delete("loaded");
    expect(session.admit(Y.encodeStateAsUpdate(app, before))).toBe(false);
    const edit = new Y.Doc();
    Y.applyUpdate(edit, Y.encodeStateAsUpdate(doc));
    const editBefore = Y.encodeStateVector(edit);
    edit.getMap("content").set("value", 9);
    expect(session.admit(Y.encodeStateAsUpdate(edit, editBefore))).toBe(true);
    expect(session.admit(Y.encodeStateAsUpdate(edit))).toBe(true);
    session.close();
  });

  it("keeps a text room's unsent edits as a conflicted copy when the room is replaced", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const { session, provider, events, failures, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    provider.down();
    doc.getText("text").insert(5, " offline");
    provider.up();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false, generation: "g2" });
    await vi.waitFor(() => expect(failures).toEqual([expect.objectContaining({ code: "closed" })]));
    expect(drive.write).toHaveBeenCalledTimes(1);
    const [, , name, bytes] = vi.mocked(drive.write).mock.calls[0]!;
    expect(name).toBe("a.bin (conflicted copy)");
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe("hello offline");
    expect(of(events, "problem").at(-1)).toMatchObject({
      code: "reloaded",
      message: expect.stringContaining("Your unsaved changes were kept in a.bin (conflicted copy)."),
    });
    session.close();
  });

  it("asks the app for its unsaved document before a replaced room closes, and keeps it beside the file", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const { session, provider, events, failures, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    provider.down();
    doc.getMap("content").set("value", 3);
    provider.up();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false, generation: "g2" });
    expect(failures).toHaveLength(0);
    const asked = of(events, "serialize").at(-1);
    expect(asked).toBeDefined();
    await session.serialized(asked!.request as number, new Uint8Array([3]));
    await vi.waitFor(() => expect(failures).toEqual([expect.objectContaining({ code: "closed" })]));
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toBeUndefined();
    expect(of(events, "problem").at(-1)).toMatchObject({
      code: "reloaded",
      message: expect.stringContaining("Your unsaved changes were kept in a.bin (conflicted copy)."),
    });
    session.close();
  });

  it("closes a replaced room within a bound when the app never hands over its document", async () => {
    const { session, provider, events, failures, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    loadInto(doc, 5);
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    provider.down();
    doc.getMap("content").set("value", 3);
    provider.up();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false, generation: "g2" });
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(failures).toEqual([expect.objectContaining({ code: "closed" })]));
    expect(drive.write).not.toHaveBeenCalled();
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "reloaded" });
    session.close();
  });

  it("checks the drive's version when it becomes the writer, and asks for a fresh room when the file moved on", async () => {
    const { session, provider, doc } = await open();
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true });
    loadInto(doc, 5);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    expect(provider.sent.some((message) => message.type === "file_reload")).toBe(false);
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 8 });
    session.close();
  });

  it("reports a save that settles after it lost the writer, without marking the file itself", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "downloaded" }] });
    await vi.waitFor(() => expect(provider.sent.at(-1)).toMatchObject({ type: "file_saved", version: 6 }));
    expect(doc.getMap(FILE_META).get("saved")).toBeUndefined();
    session.close();
  });

  it("refuses the app's load when another copy loaded the file first", async () => {
    const { session, provider, events, failures, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: false });
    await flush();
    expect(of(events, "load")).toHaveLength(1);
    const other = new Y.Doc();
    other.transact(() => {
      other.getMap("content").set("value", 1);
      other.getMap(FILE_META).set("loaded", 5);
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), provider);
    const app = new Y.Doc();
    app.transact(() => {
      app.getMap("content").set("value", 2);
      app.getMap(FILE_META).set("loaded", 5);
    });
    expect(session.admit(Y.encodeStateAsUpdate(app))).toBe(false);
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "reloaded" });
    expect(failures).toEqual([expect.objectContaining({ code: "closed" })]);
    session.close();
  });

  it("judges a drive change that came in while its save was being written, once it's written", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    let finish!: (entry: unknown) => void;
    drive.write = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    const saving = session.serialized(asked!.request as number, new Uint8Array([2]));
    await flush();
    expect(drive.write).toHaveBeenCalledTimes(1);
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "downloaded" }] });
    finish({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" });
    await saving;
    await vi.waitFor(() => expect(provider.sent.at(-1)).toMatchObject({ type: "file_saved", version: 6 }));
    session.close();
  });

  it("doesn't take a same-sized change at another time for its save over a renamed file", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 7, size: 1, mtime_ms: 300, state: "downloaded" }] });
    expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 7)).toBe(false);
    expect(of(events, "serialize")).toHaveLength(1);
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 7 });
    session.close();
  });

  it("treats a save the drive marks as conflicting as a change made somewhere else", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 5, size: 1, state: "conflict" }] });
    expect(of(events, "serialize")).toHaveLength(1);
    await flush();
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "save_failed" });
    expect(provider.sent).toContainEqual({ type: "file_outside" });
    session.close();
  });

  it("asks the server to keep a text room's text beside the changed file, and pauses edits meanwhile", async () => {
    const { session, provider, events, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    doc.getText("text").insert(5, " there");
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 8 });
    expect(provider.sent.some((message) => message.type === "file_outside")).toBe(false);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getText("text").insert(11, "!");
    expect(session.admit(Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)))).toBe(false);
    expect(doc.getText("text").toString()).toBe("hello there");
    provider.say({ type: "file_resolving", version: 8 });
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "stalled" });
    expect(drive.write).not.toHaveBeenCalled();
    session.close();
  });

  it("asks the server to keep a text room's text when it says the drive refused a stale save", async () => {
    const { session, provider, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    provider.say({
      type: "file_writer",
      writer: true,
      dirty: true,
      loaded: true,
      generation: "g1",
      outside: true,
      drive_version: 8,
    });
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 8 });
    expect(drive.write).not.toHaveBeenCalled();
    session.close();
  });

  it("lets a text room's other editors ask for a clean room afresh", async () => {
    const { session, provider, doc } = await open("text");
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 8 }] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 8 });
    session.close();
  });

  it("says saves stopped when the server says a text room's file changed somewhere else", async () => {
    const { session, provider, events } = await open("text");
    provider.say({ type: "file_writer", writer: false, dirty: true, loaded: true, generation: "g1", outside: true });
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "save_failed" });
    expect(provider.sent.some((message) => message.type === "file_outside")).toBe(false);
    session.close();
  });

  it("doesn't try to keep a copy of unsaved changes for someone who can't edit the file", async () => {
    const { session, provider, events, failures, doc } = await open("text");
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: true, generation: "g1", read_only: true });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    provider.down();
    doc.getText("text").insert(5, " offline");
    provider.up();
    provider.say({ type: "file_writer", writer: false, dirty: false, loaded: false, generation: "g2", read_only: true });
    expect(drive.write).not.toHaveBeenCalled();
    expect(failures).toEqual([expect.objectContaining({ code: "closed" })]);
    expect(of(events, "problem").at(-1)).toMatchObject({
      code: "reloaded",
      message: expect.stringContaining("because you can't edit this file"),
    });
    session.close();
  });

  it("sends a save it couldn't report while the link was down once it is back", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    provider.down();
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "downloaded" }] });
    await flush();
    expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(false);
    provider.up();
    provider.say({ type: "file_writer", writer: true, dirty: true, loaded: true, generation: "g1", base: 5 });
    await vi.waitFor(() =>
      expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(true),
    );
    session.close();
  });

  it("reports a save that settles after the app closed the room", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    session.close();
    for (const listener of drive.changed)
      listener({ space_id: "space-1", items: [{ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "downloaded" }] });
    await vi.waitFor(() =>
      expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(true),
    );
    expect(of(events, "problem")).toHaveLength(0);
  });

  it("takes a write that failed but landed in the drive for its own save", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => {
      drive.entry = { ...drive.entry!, version: 6, size: 1, mtime_ms: Date.now(), state: "downloaded" };
      throw new Error("The drive didn't answer.");
    });
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    await vi.waitFor(() =>
      expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(true),
    );
    expect(drive.write).toHaveBeenCalledTimes(1);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("doesn't take a same-sized change from before its failed write for its own save", async () => {
    const { session, provider, events, doc } = await open();
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, base: 5 });
    loadInto(doc, 5);
    drive.write = vi.fn(async () => {
      drive.entry = { ...drive.entry!, version: 6, size: 1, mtime_ms: 100, state: "downloaded" };
      throw new Error("The drive didn't answer.");
    });
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const [asked] = of(events, "serialize");
    const saving = session.serialized(asked!.request as number, new Uint8Array([2]));
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await saving;
    expect(drive.write).toHaveBeenCalledTimes(2);
    expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 6)).toBe(false);
    expect(of(events, "problem").at(-1)).toMatchObject({ code: "save_failed" });
    session.close();
  });

  it("keeps a text room's offline edits beside the file when it closes before they are sent", async () => {
    drive.write = vi.fn(async (...args: unknown[]) => ({ ...drive.entry, name: args[2] as string }));
    const { session, provider, doc } = await open("text");
    provider.say({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1" });
    doc.transact(() => {
      doc.getText("text").insert(0, "hello");
      doc.getMap(FILE_META).set("loaded", 5);
    });
    provider.down();
    doc.getText("text").insert(5, " offline");
    session.close();
    await vi.waitFor(() => expect(drive.write).toHaveBeenCalledTimes(1));
    const [, , name, bytes] = vi.mocked(drive.write).mock.calls[0]!;
    expect(name).toBe("a.bin (conflicted copy)");
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe("hello offline");
  });
});
