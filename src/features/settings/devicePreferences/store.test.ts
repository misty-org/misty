import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DevicePreferencesState } from "./model";

const mocks = vi.hoisted(() => ({
  disk: new Map<string, unknown>(),
  failWrite: false,
  apply: vi.fn(async (_values: unknown, _valid?: () => boolean) => {}),
  preview: vi.fn((_values: unknown) => {}),
}));
vi.mock("../store/useSettingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      applyPreferenceValues: mocks.apply,
      previewPreferenceValues: mocks.preview,
    }),
  },
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
import { useDevicePreferences as store } from "./store";
import { resolveSetting } from "./model";

const key = "browser.homepage";
async function setup(scope = "device", values: Record<string, unknown> = { [key]: "old" }) {
  mocks.disk.set(scope, { version: 3, values });
  await store.getState().configure(scope, {});
}
describe("device settings controller", () => {
  beforeEach(() => {
    store.getState().disconnect();
    mocks.disk.clear();
    mocks.failWrite = false;
    vi.clearAllMocks();
    vi.stubGlobal("BroadcastChannel", undefined);
  });
  afterEach(() => {
    store.getState().disconnect();
    vi.unstubAllGlobals();
  });

  it("shows an edit before saving it to this device", async () => {
    await setup();
    const pending = store.getState().edit(key, "new");
    expect(resolveSetting(store.getState().state!, key).value).toBe("new");
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ [key]: "new" }));
    await pending;
    expect((mocks.disk.get("device") as DevicePreferencesState).values[key]).toBe("new");
  });

  it("puts the saved value back when an edit fails to save", async () => {
    await setup();
    mocks.apply.mockClear();
    mocks.failWrite = true;
    const pending = store.getState().edit(key, "unsaved");
    expect(resolveSetting(store.getState().state!, key).value).toBe("unsaved");
    await expect(pending).rejects.toThrow("Disk full");
    expect(resolveSetting(store.getState().state!, key).value).toBe("old");
    expect(mocks.apply).toHaveBeenLastCalledWith(
      expect.objectContaining({ [key]: "old" }),
      expect.any(Function),
    );
    expect(store.getState().error).toContain("Disk full");
  });

  it("keeps edits across a restart", async () => {
    await setup();
    await store.getState().edit(key, "kept");
    store.getState().disconnect();
    await store.getState().configure("device", {});
    expect(resolveSetting(store.getState().state!, key).value).toBe("kept");
  });

  it("changes settings without being signed in, and keeps them per device scope", async () => {
    await store.getState().configure("device", {});
    await store.getState().edit(key, "signed-out edit");
    expect(resolveSetting(store.getState().state!, key).value).toBe("signed-out edit");
    await store.getState().configure("other-deployment", {});
    expect(resolveSetting(store.getState().state!, key).value).toBe("");
  });

  it("applies the saved values once when it reads them again", async () => {
    await setup();
    mocks.apply.mockClear();
    await store.getState().refresh();
    await store.getState().refresh();
    // Nothing changed, so nothing is applied again.
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("does not save or apply an unchanged preference", async () => {
    await setup();
    mocks.apply.mockClear();
    await store.getState().edit(key, "old");
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("resets a setting to its default", async () => {
    await setup();
    await store.getState().edit(key, undefined);
    expect((mocks.disk.get("device") as DevicePreferencesState).values).toEqual({});
  });
});
