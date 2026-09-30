import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceProfileState, SettingsProfile } from "./model";

const mocks = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  failWrite: false,
  generation: 0,
  apply: vi.fn(async (_values: unknown, _valid?: () => boolean) => {}),
  ensure: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/api/client/session", () => ({ readApiSessionGeneration: () => mocks.generation }));
vi.mock("../store/useSettingsStore", () => ({
  useSettingsStore: { getState: () => ({ applyProfileValues: mocks.apply }) },
}));
vi.mock("./persistence", () => ({
  readState: async (scope: string) => ({ state: structuredClone(mocks.disk.get(scope) ?? null) }),
  mutateState: async (scope: string, seed: () => unknown, reduce: (s: unknown) => unknown) => {
    if (mocks.failWrite) throw new Error("Disk full");
    const next = reduce(structuredClone(mocks.disk.get(scope) ?? seed()));
    mocks.disk.set(scope, structuredClone(next));
    return next;
  },
}));
vi.mock("./api", () => ({ settingsProfilesApi: mocks }));
import { useSettingsProfiles as store } from "./store";
import { initialProfileState, resolveSetting } from "./model";

const key = "browser.homepage";
const a: SettingsProfile = {
  id: "a",
  name: "Work",
  schemaVersion: 1,
  revision: 1,
  values: { [key]: "old" },
};
function online(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}
async function setup(scope = "deployment/account-a") {
  const state = initialProfileState({});
  state.profile = structuredClone(a);
  mocks.disk.set(scope, state);
  await store.getState().configure(scope, "account-a", {});
}
describe("durable settings profile controller", () => {
  beforeEach(() => {
    store.getState().disconnect();
    mocks.disk.clear();
    mocks.failWrite = false;
    mocks.generation = 0;
    vi.clearAllMocks();
    vi.stubGlobal("BroadcastChannel", undefined);
    online(false);
    mocks.ensure.mockResolvedValue(a);
    mocks.patch.mockImplementation(async (edit) => ({ ...a, revision: 2, values: edit.set }));
  });
  afterEach(() => {
    store.getState().disconnect();
    vi.unstubAllGlobals();
  });

  it("does not apply or acknowledge an edit that failed durable persistence", async () => {
    await setup();
    mocks.apply.mockClear();
    mocks.failWrite = true;
    await expect(store.getState().edit(key, "unsaved")).rejects.toThrow("Disk full");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(store.getState().state?.outbox).toHaveLength(0);
    expect(store.getState().error).toContain("Disk full");
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it("restarts offline and replays edits into the shared account record", async () => {
    await setup();
    await store.getState().edit(key, "offline edit");
    const mutation = structuredClone(store.getState().state!.outbox[0]);
    store.getState().disconnect();
    await store.getState().configure("deployment/account-a", "account-a", {});
    expect(resolveSetting(store.getState().state!, key).value).toBe("offline edit");
    online(true);
    await store.getState().refresh();
    expect(mocks.patch).toHaveBeenCalledWith(mutation);
    expect(store.getState().state?.outbox).toHaveLength(0);
    expect(resolveSetting(store.getState().state!, key).value).toBe("offline edit");
  });

  it("keeps the mutation ID after a lost response and only removes it after durable acknowledgement", async () => {
    await setup();
    await store.getState().edit(key, "new");
    const id = store.getState().state!.outbox[0].id;
    mocks.patch.mockRejectedValueOnce(new Error("Response lost"));
    online(true);
    await expect(store.getState().refresh()).rejects.toThrow("Response lost");
    expect(store.getState().state!.outbox[0].id).toBe(id);
    await store.getState().refresh();
    expect(mocks.patch.mock.calls.map(([edit]) => edit.id)).toEqual([id, id]);
    expect(store.getState().state!.outbox).toHaveLength(0);
    expect(store.getState().error).toBeNull();
  });

  it("retains a server-committed edit when saving the acknowledgement fails", async () => {
    await setup();
    await store.getState().edit(key, "committed");
    mocks.patch.mockImplementationOnce(async (edit) => {
      mocks.failWrite = true;
      return { ...a, revision: 2, values: edit.set };
    });
    online(true);
    await expect(store.getState().refresh()).rejects.toThrow("Disk full");
    expect(store.getState().state!.outbox).toHaveLength(1);
    expect(store.getState().error).toContain("Disk full");
  });

  it("ignores stale responses after changing account or deployment", async () => {
    await setup();
    await store.getState().edit(key, "a's edit");
    let finish!: (value: SettingsProfile) => void;
    mocks.patch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    online(true);
    const pending = store.getState().refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    online(false);
    mocks.generation++;
    await store.getState().configure("other-deployment/account-b", "account-b", {});
    finish({ ...a, revision: 5, values: { [key]: "stale" } });
    await pending;
    expect(store.getState().accountId).toBe("account-b");
    expect(store.getState().state!.profile).toBeNull();
    expect((mocks.disk.get("deployment/account-a") as DeviceProfileState).outbox).toHaveLength(1);
    expect(mocks.apply.mock.calls[mocks.apply.mock.calls.length - 1]?.[0]).not.toEqual({
      [key]: "stale",
    });
  });

  it("takes remote updates without a local override", async () => {
    await setup();
    mocks.ensure.mockResolvedValue({
      ...a,
      revision: 3,
      values: { [key]: "remote", "app.zoom": 1.25 },
    });
    online(true);
    await store.getState().refresh();
    expect(resolveSetting(store.getState().state!, key).value).toBe("remote");
    expect(mocks.apply).toHaveBeenLastCalledWith(
      { [key]: "remote", "app.zoom": 1.25 },
      expect.any(Function),
    );
  });
  it("queues edits before first enrollment and uses server values for unrelated settings", async () => {
    await store.getState().configure("new/account", "account-a", { appearance: { app_zoom: 2 } });
    await store.getState().edit(key, "offline");
    online(true);
    await store.getState().refresh();
    expect(mocks.ensure).toHaveBeenCalledWith({ "app.zoom": 2 });
    expect(mocks.patch).toHaveBeenCalledWith(
      expect.objectContaining({ set: { [key]: "offline" } }),
    );
    expect(store.getState().state?.seed).toEqual({});
  });
  it("does not create local-only preferences when signed out", async () => {
    await store.getState().configure("signed-out", "", {});
    await expect(store.getState().edit(key, "new")).rejects.toThrow("Sign in");
    expect(store.getState().state?.outbox).toHaveLength(0);
  });
});
