import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionEvent, ExtensionReview } from "./types";
const mocks = vi.hoisted(() => ({
  values: {} as Record<string, string | boolean>,
  account: "account-a",
  edit: vi.fn(),
  commit: vi.fn(),
}));
vi.mock("@/features/settings", () => ({
  useDevicePreferences: {
    getState: () => ({ state: {}, accountId: mocks.account, edit: mocks.edit }),
  },
  resolveSetting: (_state: unknown, key: string) => ({ value: mocks.values[key] }),
}));
vi.mock("./native", () => ({ extensionsNative: { commit: mocks.commit } }));
import {
  enqueuePermission,
  finishPermission,
  install,
  parseInstallations,
  setPreference,
  useExtensionsStore,
} from "./store";
const review = {
  token: "review",
  entry: { id: "12", store: "firefox", guid: "fixture@misty.test", name: "Fixture" },
  permissions: ["storage"],
  hosts: ["https://example.com/*"],
  blocked: false,
  privateAllowed: true,
} as ExtensionReview;
describe("extension account controls", () => {
  beforeEach(() => {
    mocks.account = "account-a";
    mocks.values = { "extensions.installations": "[]" };
    mocks.commit.mockReset();
    mocks.edit.mockReset();
    mocks.edit.mockImplementation(async (key, value) => {
      mocks.values[key] = value;
    });
    useExtensionsStore.setState({ account: "account-a", permissionRequests: [] });
  });
  it("queues simultaneous permission requests and rejects cross-account events", () => {
    const event = (requestId: string, account = "account-a"): ExtensionEvent => ({
      kind: "permission-request",
      account,
      requestId,
    });
    enqueuePermission(event("first"));
    enqueuePermission(event("second"));
    enqueuePermission(event("first"));
    enqueuePermission(event("wrong", "account-b"));
    finishPermission("first");
    expect(useExtensionsStore.getState().permissionRequests.map((v) => v.requestId)).toEqual([
      "second",
    ]);
  });
  it("does not publish an installation if the account changes during package approval", async () => {
    mocks.commit.mockImplementation(async () => {
      useExtensionsStore.setState({ account: "account-b" });
    });
    await expect(install(review, true)).rejects.toThrow("account changed");
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("preserves identity on updates and respects forbidden private access", async () => {
    await install(review, true);
    const first = parseInstallations(String(mocks.values["extensions.installations"]))[0];
    expect(first).toMatchObject({ enabled: true, privateAccess: true, agentAccess: true });
    await install({ ...review, privateAllowed: false, permissions: ["storage", "tabs"] }, true);
    expect(parseInstallations(String(mocks.values["extensions.installations"]))[0]).toMatchObject({
      generation: first.generation,
      privateAccess: false,
      permissions: ["storage", "tabs"],
    });
    expect(mocks.values["extensions.pins"]).toBeUndefined();
  });
  it("stores Firefox IDs as numbers for older versions and reads both forms", async () => {
    await install(review, true);
    const stored = JSON.parse(String(mocks.values["extensions.installations"]));
    expect(stored[0].id).toBe(12);
    expect(parseInstallations(JSON.stringify(stored))[0].id).toBe("12");
    const chrome = "ddkjiahejlhfcafbddmgiahcphecmpfh";
    await install(
      { ...review, entry: { ...review.entry, id: chrome, store: "chrome", guid: chrome } },
      false,
    );
    const both = JSON.parse(String(mocks.values["extensions.installations"]));
    expect(both.map((item: { id: unknown }) => item.id)).toEqual([12, chrome]);
    expect(parseInstallations(JSON.stringify(both)).map((item) => item.id)).toEqual(["12", chrome]);
  });
  it("drops installations whose identity does not fit their store", () => {
    const base = {
      generation: "g",
      name: "N",
      installed: true,
      enabled: true,
      privateAccess: false,
      agentAccess: true,
      permissions: [],
      hosts: [],
    };
    const chrome = "ddkjiahejlhfcafbddmgiahcphecmpfh";
    expect(
      parseInstallations(
        JSON.stringify([
          { ...base, id: chrome, guid: "someone@else" },
          { ...base, id: 7, guid: chrome },
          { ...base, id: "not-an-id", guid: "x@y" },
          { ...base, id: chrome, guid: chrome },
        ]),
      ).map((item) => item.id),
    ).toEqual([chrome]);
  });
  it("blocks incompatible packages and writes extension preferences to this device's settings", async () => {
    await expect(install({ ...review, blocked: true }, true)).rejects.toThrow("unavailable");
    expect(mocks.commit).not.toHaveBeenCalled();
    await setPreference("agent_access", false);
    expect(mocks.edit).toHaveBeenCalledWith("extensions.agent_access", false);
  });
});
