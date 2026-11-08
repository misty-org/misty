import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { startProfileRecords } from "./profileRecords";
import type { SharedRecord } from "./profileRecordModel";

const native = vi.hoisted(() => ({
  records: new Map<string, Map<string, unknown>>(),
  fail: false,
  refuse: [] as string[],
  writes: [] as { collection: string; writes: { id: string; record: unknown }[] }[],
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
}));

vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: (message: { payload: unknown }) => void) => {
    native.listeners.set(event, handler);
    return () => native.listeners.delete(event);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(
    async (
      command: string,
      args: { collection: string; writes: { id: string; record: unknown }[] },
    ) => {
      if (command === "profile_records_list")
        return [...(native.records.get(args.collection)?.values() ?? [])];
      if (command === "profile_records_write") {
        if (native.fail) throw new Error("Unavailable");
        native.writes.push(args);
        const stored = native.records.get(args.collection) ?? new Map();
        for (const { id, record } of args.writes) {
          if (native.refuse.includes(id)) continue;
          if (record) stored.set(id, record);
          else stored.delete(id);
        }
        native.records.set(args.collection, stored);
        return args.writes.filter(({ id }) => native.refuse.includes(id)).map(({ id }) => id);
      }
      return null;
    },
  ),
}));

const bookmark = (id: string, title = id): SharedRecord<"bookmark"> => ({
  kind: "bookmark",
  id,
  fields: { folder_id: "folder", title, url: `https://${id}.test/`, order: 0, pinned: true },
});
const seed = (collection: string, records: SharedRecord[]) =>
  native.records.set(collection, new Map(records.map((record) => [record.id, record])));

async function start(options?: Parameters<typeof startProfileRecords>[0]) {
  const records = await import("./profileRecords");
  const { useWorkspaceStore } = await import("../tabs/useWorkspaceStore");
  const { useProfileWindowStore } = await import("./profileWindow");
  useWorkspaceStore.getState().reset();
  const handle = records.startProfileRecords(options);
  await handle.whenSeeded;
  return { handle, store: useWorkspaceStore, profile: useProfileWindowStore };
}

describe("a profile's records", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.resetModules();
    native.records.clear();
    native.fail = false;
    native.refuse = [];
    native.writes = [];
    native.listeners.clear();
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  it("shows what the profile holds, without writing anything back", async () => {
    seed("bookmarks", [bookmark("a")]);
    const { handle, store } = await start();
    stop = handle.stop;
    expect(store.getState().bookmarks.map((item) => item.id)).toEqual(["a"]);
    expect(native.writes).toEqual([]);
  });

  it("writes only changed records after a short pause", async () => {
    seed("bookmarks", [bookmark("a"), bookmark("b")]);
    const { handle, store } = await start();
    stop = handle.stop;
    vi.useFakeTimers();
    store.setState({
      bookmarks: store
        .getState()
        .bookmarks.map((item) => (item.id === "a" ? bookmark("a", "Renamed") : item)),
    });
    await vi.advanceTimersByTimeAsync(399);
    expect(native.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(native.writes).toHaveLength(1);
    expect(native.writes[0].collection).toBe("bookmarks");
    expect(native.writes[0].writes.map((write) => write.id)).toEqual(["a"]);
  });

  it("deletes with a null record", async () => {
    seed("bookmarks", [bookmark("a")]);
    const { handle, store } = await start();
    stop = handle.stop;
    vi.useFakeTimers();
    store.setState({ bookmarks: [] });
    await vi.advanceTimersByTimeAsync(401);
    expect(native.writes[0].writes).toEqual([{ id: "a", record: null }]);
  });

  it("reloads when another window of the profile changes them", async () => {
    seed("bookmarks", [bookmark("a")]);
    const { handle, store, profile } = await start();
    stop = handle.stop;
    seed("bookmarks", [bookmark("a"), bookmark("from-other-window")]);
    native.listeners.get("misty://profile-records-changed")?.({
      payload: { profile: profile.getState().profile.id, collection: "bookmarks", remote: false },
    });
    await vi.waitFor(() =>
      expect(store.getState().bookmarks.map((item) => item.id)).toContain("from-other-window"),
    );
    expect(native.writes).toEqual([]);
  });

  it("ignores another profile's changes", async () => {
    seed("bookmarks", [bookmark("a")]);
    const { handle, store } = await start();
    stop = handle.stop;
    seed("bookmarks", []);
    native.listeners.get("misty://profile-records-changed")?.({
      payload: { profile: "someone-else", collection: "bookmarks", remote: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(store.getState().bookmarks.map((item) => item.id)).toEqual(["a"]);
  });

  it("reads stored names as its own, and never deletes what it doesn't recognize", async () => {
    native.records.set(
      "bookmarks",
      new Map<string, unknown>([
        [
          "stored",
          {
            kind: "website",
            id: "stored",
            fields: { group_id: "folder", title: "Stored", url: "https://stored.test/", order: 0 },
          },
        ],
        ["future", { kind: "future_kind", id: "future", fields: {} }],
      ]),
    );
    const { handle, store } = await start();
    stop = handle.stop;
    expect(store.getState().bookmarks).toMatchObject([
      { kind: "bookmark", id: "stored", fields: { folder_id: "folder" } },
    ]);
    expect(native.writes).toEqual([]);
    vi.useFakeTimers();
    store.setState({ bookmarks: [] });
    await vi.advanceTimersByTimeAsync(401);
    expect(native.writes[0].writes).toEqual([{ id: "stored", record: null }]);
    expect(native.records.get("bookmarks")?.has("future")).toBe(true);
  });

  it("gives a profile with no records what the window opened with, once", async () => {
    const { handle, store } = await start({ bookmarks: [bookmark("legacy")] });
    stop = handle.stop;
    expect(native.records.get("bookmarks")?.has("legacy")).toBe(true);
    expect(store.getState().bookmarks.map((item) => item.id)).toEqual(["legacy"]);
    expect(handle.seeded()).toBe(true);
    expect(native.writes).toHaveLength(1);
  });

  it("never overwrites a profile that already has records", async () => {
    seed("bookmarks", [bookmark("kept")]);
    const { handle, store } = await start({ bookmarks: [bookmark("legacy")] });
    stop = handle.stop;
    expect(native.records.get("bookmarks")?.has("legacy")).toBe(false);
    expect(store.getState().bookmarks.map((item) => item.id)).toEqual(["kept"]);
  });

  it("stays unseeded while writes fail, and keeps the edit", async () => {
    native.fail = true;
    const { startProfileRecords } = await import("./profileRecords");
    const { useWorkspaceStore } = await import("../tabs/useWorkspaceStore");
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.setState({ bookmarks: [bookmark("legacy")] });
    const handle = startProfileRecords({ bookmarks: [bookmark("legacy")] });
    stop = handle.stop;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(handle.seeded()).toBe(false);
    expect(useWorkspaceStore.getState().bookmarks.map((item) => item.id)).toEqual(["legacy"]);
  });

  it("doesn't send a refused record again until it changes, and says so", async () => {
    seed("bookmarks", []);
    const { handle, store } = await start();
    stop = handle.stop;
    const notice = vi.fn();
    window.addEventListener("misty:workspace-notice", notice);
    native.refuse = ["bad"];
    vi.useFakeTimers();
    store.setState({ bookmarks: [bookmark("bad")] });
    await vi.advanceTimersByTimeAsync(401);
    expect(native.writes).toHaveLength(1);
    expect(notice).toHaveBeenCalledTimes(1);
    store.setState({ bookmarks: [bookmark("bad"), bookmark("good")] });
    await vi.advanceTimersByTimeAsync(401);
    expect(native.writes[1].writes.map((write) => write.id)).toEqual(["good"]);
    window.removeEventListener("misty:workspace-notice", notice);
  });

  it("keeps saved tab groups as records and open ones with the window", async () => {
    const { handle, store } = await start();
    stop = handle.stop;
    vi.useFakeTimers();
    store.setState({
      tabGroups: [
        { id: "open", name: "Open", color: "blue", collapsed: false },
        { id: "saved", name: "Saved", color: "red", collapsed: false, savedTabs: [] },
      ],
    });
    await vi.advanceTimersByTimeAsync(401);
    expect(native.writes[0].collection).toBe("tab_groups");
    expect(native.writes[0].writes.map((write) => write.id)).toEqual(["saved"]);
    expect(native.writes[0].writes[0].record).toMatchObject({
      kind: "saved_tab_group",
      fields: { name: "Saved", color: "red", tabs: "[]" },
    });
  });

  it("drops a saved group a sibling window reopened, keeping this window's open ones", async () => {
    seed("tab_groups", [
      {
        kind: "saved_tab_group",
        id: "saved",
        fields: { name: "Saved", color: "red", order: 0, tabs: "[]" },
      },
    ]);
    const { handle, store, profile } = await start();
    stop = handle.stop;
    store.setState((state) => ({
      tabGroups: [
        { id: "open", name: "Open", color: "blue", collapsed: false },
        ...state.tabGroups,
      ],
    }));
    seed("tab_groups", []);
    native.listeners.get("misty://profile-records-changed")?.({
      payload: { profile: profile.getState().profile.id, collection: "tab_groups", remote: false },
    });
    await vi.waitFor(() =>
      expect(store.getState().tabGroups.map((group) => group.id)).toEqual(["open"]),
    );
  });
});
