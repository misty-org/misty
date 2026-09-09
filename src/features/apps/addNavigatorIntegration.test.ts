import { beforeEach, expect, it, vi } from "vitest";
import { addNavigatorIntegration } from "./addNavigatorIntegration";
import { appLocalStoragePrefix } from "./appLocalStorage";

const fixture = vi.hoisted(() => ({
  store: {
    accountId: "account",
    spaceId: "space",
    catalog: [{ id: "planner", app_id: "planner-runtime" }],
  },
  trusted: true,
  resolve: vi.fn(async () => "https://misty.test"),
}));
vi.mock("@/api/client", () => ({
  assertStableApiSession: vi.fn(),
  readApiSessionGeneration: () => 1,
  resolveRequiredApiBase: () => fixture.resolve(),
}));
vi.mock("./useAppsStore", () => ({ useAppsStore: { getState: () => fixture.store } }));
vi.mock("./trustedHostApps", () => ({ isTrustedHostApp: () => fixture.trusted }));
beforeEach(() => {
  localStorage.clear();
  fixture.store = {
    accountId: "account",
    spaceId: "space",
    catalog: [{ id: "planner", app_id: "planner-runtime" }],
  };
  fixture.trusted = true;
  fixture.resolve.mockReset().mockResolvedValue("https://misty.test");
});
it("adds to the app's scoped storage without replacing an existing service", async () => {
  const key = `${appLocalStoragePrefix("https://misty.test", "account", "planner-runtime", "space")}website-integration-v1:service:todoist`;
  await addNavigatorIntegration("account", "planner", "todoist");
  const saved = localStorage.getItem(key);
  expect(JSON.parse(saved!)).toEqual({ id: "todoist", order: expect.any(Number) });
  await addNavigatorIntegration("account", "planner", "todoist");
  expect(localStorage.getItem(key)).toBe(saved);
});
it("refuses a workspace change while resolving the storage scope", async () => {
  fixture.resolve.mockImplementationOnce(async () => {
    fixture.store = { ...fixture.store, spaceId: "another-space" };
    return "https://misty.test";
  });
  await expect(addNavigatorIntegration("account", "planner", "todoist")).rejects.toThrow(
    "workspace changed",
  );
  expect(localStorage.length).toBe(0);
});
it("rejects untrusted apps before writing", async () => {
  fixture.trusted = false;
  await expect(addNavigatorIntegration("account", "planner", "todoist")).rejects.toThrow(
    "not available",
  );
  expect(localStorage.length).toBe(0);
});
