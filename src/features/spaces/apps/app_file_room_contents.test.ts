import { webcrypto } from "node:crypto";
import { Observable } from "lib0/observable";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Y from "yjs";
import type { DriveEntry } from "../drive/drive_native";
import { contentFloor } from "./app_file_room_renames";
import { FILE_META, fileRoomOpener } from "./app_file_rooms";

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

const api = vi.hoisted(() => ({
  versions: null as Record<string, unknown> | null,
  asked: [] as string[],
}));

vi.mock("../api/api", () => ({
  spaceRequest: async (path: string) => {
    api.asked.push(path);
    if (!api.versions) throw new Error("offline");
    return { ...api.versions };
  },
}));

vi.mock("../drive/drive_app_files", () => ({
  conflictedCopyName: (name: string) => `${name} (conflicted copy)`,
  driveFileRef: (entry: { id: string; name: string }) => ({ id: entry.id, name: entry.name }),
  driveHostError: (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
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
  api.versions = null;
  api.asked = [];
  drive.entry = {
    id: "file-1",
    name: "a.bin",
    path: "/a.bin",
    kind: "file",
    version: 5,
    size: 3,
    mtime_ms: 100,
    state: "downloaded",
    content_version: 4,
  };
  drive.read = vi.fn(async () => new Uint8Array([1, 2, 3]).buffer);
  drive.write = vi.fn(async () => ({ ...drive.entry }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("content floor", () => {
  const at = (version: number, content: number | undefined, state = "downloaded") =>
    ({ id: "file-1", kind: "file", name: "a.bin", path: "/a.bin", version, size: 3, state, content_version: content }) as unknown as DriveEntry;

  it("knows every version whose content is the room's, and leaves older drives to the fallback", () => {
    const state = { base: 5, entry: at(6, 4), fallback: 9 };
    const contents = contentFloor({ base: () => state.base, entry: () => state.entry, fallback: { known: () => state.fallback } });
    expect(contents.known()).toBe(6);
    state.entry = at(7, 7);
    expect(contents.known()).toBe(6);
    state.entry = at(8, 4, "uploading");
    expect(contents.known()).toBe(6);
    state.entry = at(8, undefined);
    expect(contents.known()).toBe(9);
    expect(contents.note(at(9, undefined))).toBe(false);
    expect(contents.note(at(9, 5))).toBe(true);
    state.entry = at(9, 5);
    expect(contents.known()).toBe(9);
    expect(contents.same(at(10, 5), 5)).toBe(true);
    expect(contents.same(at(10, 6), 5)).toBe(false);
    expect(contents.same(at(10, 5, "uploading"), 5)).toBe(false);
    expect(contents.same(at(10, undefined), 5)).toBe(false);
  });
});

describe("file room outside changes by content version", () => {
  it("takes a change whose content version didn't move for a rename, even when its time moved", async () => {
    const { session, provider, events, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    changed({ ...drive.entry, version: 6, name: "b.bin", path: "/b.bin", mtime_ms: 300 });
    changed({ ...drive.entry, version: 7, name: "b.bin", path: "/b.bin", mtime_ms: 300 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    expect(provider.sent.some((message) => message.renamed !== undefined)).toBe(false);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("takes a same-sized change that kept its time for an outside change once its content version moved", async () => {
    const { session, provider, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    changed({ ...drive.entry, version: 6, content_version: 6 });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 6 });
    expect(provider.sent.some((message) => message.renamed !== undefined)).toBe(false);
    session.close();
  });

  it("takes a rename that also changed the content for an outside change", async () => {
    const { session, provider, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    changed({ ...drive.entry, version: 6, content_version: 6, name: "b.bin", path: "/b.bin" });
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 6 });
    session.close();
  });

  it("takes a rename made before the room opened for a rename once the room knows its base", async () => {
    drive.entry = { ...drive.entry!, version: 6, content_version: 5, name: "b.bin", path: "/b.bin" };
    const { session, provider, events, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    changed({ ...drive.entry, version: 7 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("keeps a save still uploading waiting through a rename whose content didn't move, then confirms it", async () => {
    const opened = await open();
    const { session, provider, events, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    await save(opened, 2);
    const renamed = { ...drive.entry, name: "b.bin", path: "/b.bin", mtime_ms: 300 };
    changed({ ...renamed, version: 6 });
    expect(doc.getMap(FILE_META).get("saved")).toBeUndefined();
    changed({ ...renamed, version: 7, size: 1, mtime_ms: 200, content_version: 7 });
    expect(doc.getMap(FILE_META).get("saved")).toBe(7);
    changed({ ...renamed, version: 8, size: 1, mtime_ms: 200, content_version: 7, name: "c.bin", path: "/c.bin" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    session.close();
  });

  it("takes an outside edit that kept its size and time during an uploading save for an outside change", async () => {
    const opened = await open();
    const { session, provider, doc } = opened;
    provider.say(writer(5));
    loadInto(doc, 5);
    drive.write = vi.fn(async () => ({ ...drive.entry, size: 1, mtime_ms: 200, state: "uploading" }));
    await save(opened, 2);
    changed({ ...drive.entry, version: 6, content_version: 6 });
    expect(doc.getMap(FILE_META).get("saved")).toBeUndefined();
    expect(leftAlone(provider)).toBe(false);
    session.close();
  });
});

describe("file room content mode", () => {
  const modes = (provider: FakeProvider) => provider.sent.filter((message) => message.type === "file_mode");

  it("tells the room once per link that it reads content versions", async () => {
    const { session, provider, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    provider.say(writer(5));
    expect(modes(provider)).toEqual([{ type: "file_mode", content: true }]);
    provider.disconnect();
    provider.up();
    provider.say(writer(5));
    expect(modes(provider)).toHaveLength(2);
    session.close();
  });

  it("says nothing of content mode when the drive gives no content versions", async () => {
    drive.entry = { ...drive.entry!, content_version: undefined };
    const { session, provider, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    expect(modes(provider)).toHaveLength(0);
    session.close();
  });
});

describe("file room content versions read from the server", () => {
  const before = (entry: Record<string, unknown>) => ({ ...drive.entry!, content_version: undefined, ...entry });

  it("reads a file's content version from the server when the drive's row predates it, so an earlier rename isn't an outside change", async () => {
    drive.entry = before({ version: 6, name: "b.bin", path: "/b.bin" });
    api.versions = { id: "file-1", version: 6, content_version: 5 };
    const { session, provider, events, doc } = await open();
    expect(api.asked).toEqual(["/spaces/space-1/drive/items/file-1"]);
    provider.say(writer(5));
    loadInto(doc, 5);
    api.versions = { id: "file-1", version: 7, content_version: 5 };
    changed(before({ version: 7, name: "b.bin", path: "/b.bin" }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.asked).toHaveLength(2);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    expect(provider.sent).toContainEqual({ type: "file_mode", content: true });
    session.close();
  });

  it("catches an outside edit on such a file that kept its size and time, which looks like a rename", async () => {
    drive.entry = before({ version: 5 });
    api.versions = { id: "file-1", version: 5, content_version: 4 };
    const { session, provider, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    api.versions = { id: "file-1", version: 6, content_version: 6 };
    changed(before({ version: 6 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.sent).toContainEqual({ type: "file_reload", version: 6 });
    session.close();
  });

  it("asks again only when the version moves past what the server said", async () => {
    drive.entry = before({ version: 5 });
    api.versions = { id: "file-1", version: 6, content_version: 4 };
    const { session, provider, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    changed(before({ version: 6, name: "b.bin", path: "/b.bin" }));
    expect(api.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(leftAlone(provider)).toBe(true);
    session.close();
  });

  it("falls back to telling renames apart by their look when the server can't say", async () => {
    drive.entry = before({ version: 5 });
    const { session, provider, events, doc } = await open();
    provider.say(writer(5));
    loadInto(doc, 5);
    changed(before({ version: 6, name: "b.bin", path: "/b.bin" }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.asked).toHaveLength(1);
    expect(leftAlone(provider)).toBe(true);
    expect(of(events, "problem")).toHaveLength(0);
    expect(provider.sent.some((message) => message.type === "file_mode")).toBe(false);
    session.close();
  });
});
