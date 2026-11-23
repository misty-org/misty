import { webcrypto } from "node:crypto";
import { Observable } from "lib0/observable";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import { FILE_META, fileRoomOpener } from "./app_file_rooms";
import { contentSha, matchesSave } from "./app_file_room_saves";
import type { DriveEntry } from "../drive/drive_native";

vi.mock("@misty/ui", () => ({ notify: () => {} }));

const hooks = vi.hoisted(() => ({
  create: null as unknown as (doc: unknown) => unknown,
}));

const drive = vi.hoisted(() => ({
  entry: null as Record<string, unknown> | null,
  lookup: undefined as (() => Promise<void>) | undefined,
  read: null as unknown as (...args: unknown[]) => Promise<ArrayBuffer>,
  write: null as unknown as (...args: unknown[]) => Promise<unknown>,
  changed: new Set<(changed: unknown) => void>(),
}));

vi.mock("../journal/notes/create_yjs_provider", () => ({
  createYjsProvider: (_initial: unknown, doc: unknown) => hooks.create(doc),
  firstCollaborationTicket: (fetch: () => Promise<unknown>) => fetch(),
  requestCollaborationTicket: async () => ({ ticket: "ticket", room: "room", url: "https://collab.test", format: "app" }),
  withTimeout: (promise: Promise<unknown>) => promise,
}));

vi.mock("../drive/drive_native", () => ({
  driveEntryById: async () => {
    if (drive.lookup) await drive.lookup();
    return drive.entry;
  },
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
    this.emit("connection-close", [null]);
    this.wsconnected = false;
    this.ws = null;
    this.synced = false;
    this.emit("sync", [false]);
    this.emit("status", [{ status: "disconnected" }]);
  }

  up() {
    this.wsconnected = true;
    this.ws = { readyState: WebSocket.OPEN, send: () => {} };
    this.emit("status", [{ status: "connected" }]);
    this.synced = true;
    this.emit("sync", [true]);
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

async function open() {
  const events: Record<string, unknown>[] = [];
  const session = await fileRoomOpener("space-1", "app", { hold: async () => () => {} })(
    "file-1",
    { gc: true },
    (event) => events.push(event as Record<string, unknown>),
    () => {},
  );
  const provider = providers.at(-1)!;
  provider.up();
  session.started();
  return { session, provider, events, doc: provider.doc };
}

const of = (events: Record<string, unknown>[], type: string) => events.filter((event) => event.type === type);

const loadInto = (doc: Y.Doc, version: number) =>
  doc.transact(() => {
    doc.getMap("content").set("value", 1);
    doc.getMap(FILE_META).set("loaded", version);
  });

const changed = (item: Record<string, unknown>) => {
  for (const listener of drive.changed) listener({ space_id: "space-1", items: [item] });
};

const writer = (base: number) => ({ type: "file_writer", writer: true, dirty: false, loaded: true, generation: "g1", base });

const leftAlone = (provider: FakeProvider) =>
  !provider.sent.some((message) => ["file_outside", "file_resolve", "file_reload"].includes(message.type as string));

async function save(session: Awaited<ReturnType<typeof open>>, value: number) {
  session.doc.getMap("content").set("value", value);
  await vi.advanceTimersByTimeAsync(1500);
  const asked = of(session.events, "serialize").at(-1);
  expect(asked).toBeDefined();
  await session.session.serialized(asked!.request as number, new Uint8Array([value]));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("crypto", webcrypto);
  providers.length = 0;
  drive.changed.clear();
  drive.lookup = undefined;
  drive.entry = {
    id: "file-1",
    name: "a.bin",
    path: "/a.bin",
    kind: "file",
    version: 5,
    size: 3,
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

describe("file room saves beside renames", () => {
  it("takes a rename after a save that changed nothing for a rename", async () => {
    drive.entry = { ...drive.entry!, size: 1 };
    const opened = await open();
    const { session, provider, events, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => {
      const same = { ...drive.entry, mtime_ms: 200 };
      changed(same);
      return same;
    });
    await save(opened, 2);
    expect(doc.getMap(FILE_META).get("saved")).toBe(5);
    const renamed = { ...drive.entry, mtime_ms: 200, name: "b.bin", path: "/b.bin" };
    changed(renamed);
    changed({ ...renamed, version: 6 });
    expect(provider.sent).toContainEqual({ type: "file_saved", renamed: 6 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("takes the next version of a file renamed on this computer just before it opened for a rename", async () => {
    drive.entry = { ...drive.entry!, name: "b.bin", path: "/b.bin" };
    const { session, provider, events, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    changed({ ...drive.entry, version: 6 });
    expect(provider.sent).toContainEqual({ type: "file_saved", renamed: 6 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("doesn't count a save that matched a drive still behind the room, and saves again once the drive catches up", async () => {
    drive.entry = { ...drive.entry!, size: 1 };
    const opened = await open();
    const { session, provider, doc, events } = opened;
    provider.say(writer(7));
    loadInto(doc, 7);
    drive.write = vi.fn(async () => ({ ...drive.entry, mtime_ms: 200 }));
    provider.say({ ...writer(7), dirty: true });
    await save(opened, 2);
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 7 });
    expect(doc.getMap(FILE_META).get("saved")).not.toBe(7);
    expect(provider.sent.some((message) => message.type === "file_saved" && message.version === 7)).toBe(false);
    const asked = of(events, "serialize").length;
    changed({ ...drive.entry, version: 7, size: 3, mtime_ms: 300 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(of(events, "serialize")).toHaveLength(asked + 1);
    expect(provider.sent.some((message) => message.type === "file_resolve" || message.type === "file_reload")).toBe(false);
    session.close();
  });

  it("saves over the base the room holds right when it writes, not the one from when the app handed the file over", async () => {
    const opened = await open();
    const { session, provider, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    doc.getMap("content").set("value", 2);
    await vi.advanceTimersByTimeAsync(1500);
    const asked = of(opened.events, "serialize").at(-1);
    drive.lookup = async () => {
      drive.lookup = undefined;
      provider.say({ ...writer(6), dirty: true });
    };
    await session.serialized(asked!.request as number, new Uint8Array([2]));
    expect(vi.mocked(drive.write).mock.calls[0]![4]).toEqual({ item_id: "file-1", version: 6 });
    session.close();
  });

  it("keeps the entry its save wrote over an older one that came in at the same version meanwhile", async () => {
    const opened = await open();
    const { session, provider, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    const stale = { ...drive.entry };
    drive.entry = { ...drive.entry, name: "b.bin", path: "/b.bin" };
    const written = { ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" };
    let writes = 0;
    drive.write = vi.fn(async () => {
      writes += 1;
      if (writes === 1) changed(stale);
      return written;
    });
    await save(opened, 2);
    drive.entry = null;
    await save(opened, 3);
    expect(drive.write).toHaveBeenCalledTimes(2);
    expect(vi.mocked(drive.write).mock.calls[1]![2]).toBe("b.bin");
    session.close();
  });

  it("keeps a save still uploading waiting through a rename, and confirms it once it lands", async () => {
    const opened = await open();
    const { session, provider, events, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    await save(opened, 2);
    const renamed = { ...drive.entry, name: "b.bin", path: "/b.bin" };
    changed({ ...renamed, version: 6 });
    expect(doc.getMap(FILE_META).get("saved")).toBeUndefined();
    changed({ ...renamed, version: 7, size: 1, mtime_ms: 200 });
    expect(doc.getMap(FILE_META).get("saved")).toBe(7);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });
});

describe("file room saves by content hash", () => {
  const entry = (fields: Partial<DriveEntry>): DriveEntry => ({ ...(drive.entry as unknown as DriveEntry), ...fields });

  it("hashes bytes as the drive does, in lowercase hex SHA-256", async () => {
    expect(await contentSha(new TextEncoder().encode("hello"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(await contentSha(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches a save by its hash when both sides carry one, else by its time", () => {
    expect(matchesSave({ mtime: 200, sha: "a" }, entry({ mtime_ms: 200, sha: "b" }))).toBe(false);
    expect(matchesSave({ mtime: 200, sha: "a" }, entry({ mtime_ms: 300, sha: "a" }))).toBe(true);
    expect(matchesSave({ mtime: 200, sha: "a" }, entry({ mtime_ms: 200 }))).toBe(true);
    expect(matchesSave({ mtime: 200 }, entry({ mtime_ms: 300, sha: "a" }))).toBe(false);
    expect(matchesSave({ version: 6, sha: "a" }, entry({ version: 7, sha: "a" }))).toBe(false);
  });

  it("takes a same-sized copy kept with its time during the upload for an outside change, not its save", async () => {
    const opened = await open();
    const { session, provider, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    await save(opened, 2);
    const theirs = await contentSha(new Uint8Array([9]));
    changed({ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "downloaded", sha: theirs });
    expect(doc.getMap(FILE_META).get("saved")).toBeUndefined();
    expect(provider.sent).toContainEqual({ type: "file_resolve", version: 6 });
    session.close();
  });

  it("confirms its save when the settled hash is the one it wrote", async () => {
    const opened = await open();
    const { session, provider, events, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    await save(opened, 2);
    const ours = await contentSha(new Uint8Array([2]));
    changed({ ...drive.entry, version: 6, size: 1, mtime_ms: 250, state: "downloaded", sha: ours });
    expect(doc.getMap(FILE_META).get("saved")).toBe(6);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("falls back to the time when the drive gives no hash", async () => {
    const opened = await open();
    const { session, provider, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    await save(opened, 2);
    changed({ ...drive.entry, version: 6, size: 1, mtime_ms: 200, state: "downloaded" });
    expect(doc.getMap(FILE_META).get("saved")).toBe(6);
    expect(leftAlone(provider)).toBe(true);
    session.close();
  });
});
