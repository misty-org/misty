import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionEvent, ExtensionReview } from "./types";
const mocks = vi.hoisted(() => ({
  values: {} as Record<string, string | boolean>,
  account: "account-a",
  edit: vi.fn(),
  commit: vi.fn(),
}));
vi.mock("@/features/settings", () => ({
  useSettingsProfiles: {
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
  entry: { id: 12, guid: "fixture@misty.test", name: "Fixture" },
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
  it("blocks incompatible packages and account-mismatched preference writes", async () => {
    await expect(install({ ...review, blocked: true }, true)).rejects.toThrow("unavailable");
    expect(mocks.commit).not.toHaveBeenCalled();
    mocks.account = "account-b";
    await expect(setPreference("agent_access", false)).rejects.toThrow("account changed");
    expect(mocks.edit).not.toHaveBeenCalled();
  });
});
