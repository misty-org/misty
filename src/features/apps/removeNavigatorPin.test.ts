import { afterEach, expect, it, vi } from "vitest";
import { removeNavigatorPin } from "./removeNavigatorPin";
import { appLocalStoragePrefix } from "./appLocalStorage";
import { useAppsStore } from "./useAppsStore";
import { useAppNavigationStore } from "./appNavigation";
import { useWorkspaceStore } from "@/features/workspace";
import type { OfficialApp } from "@/api/apps";
vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveRequiredApiBase: vi.fn(async () => "https://example.test/v1"),
}));
const apps = useAppsStore.getState();
const navigation = useAppNavigationStore.getState();
afterEach(() => {
  useAppsStore.setState(apps);
  useAppNavigationStore.setState(navigation);
  localStorage.clear();
  vi.restoreAllMocks();
});
const item = { id: "pin-page-1", label: "Messages", route: "/apps/social?pin=page-1" };
function setup(appId: string) {
  const app = {
    id: appId,
    app_id: `com.misty.${appId === "chat" ? "social" : appId}`,
    official: true,
    publisher: "Misty",
  } as OfficialApp;
  useAppsStore.setState({ accountId: "one", catalog: [app] });
  useAppNavigationStore.setState({
    entries: [],
    providerCache: [
      {
        identity: { accountId: "one", appId },
        items: [item, { ...item, id: "pin-keep", route: "/apps/social?pin=keep" }],
      },
      { identity: { accountId: "two", appId }, items: [item] },
    ],
  });
  return app;
}
it.each(["browser", "chat", "inbox", "planner", "journal", "library"])(
  "unpins from %s without opening a page and refreshes saved navigation",
  async (appId) => {
    const app = setup(appId);
    const key =
      appId === "browser"
        ? "browser-page-pin-v1:page-1"
        : appId === "chat" || appId === "inbox"
          ? "provider-page-pin-v1:page-1"
          : "website-integration-v1:pin:page-1";
    const own = appLocalStoragePrefix(
      "https://example.test/v1",
      "one",
      app.app_id!,
      useAppsStore.getState().spaceId,
    );
    const other = appLocalStoragePrefix(
      "https://example.test/v1",
      "two",
      app.app_id!,
      useAppsStore.getState().spaceId,
    );
    const server = appLocalStoragePrefix(
      "https://other.test/v1",
      "one",
      app.app_id!,
      useAppsStore.getState().spaceId,
    );
    for (const prefix of [own, other, server])
      localStorage.setItem(prefix + key, JSON.stringify({ id: "page-1" }));
    localStorage.setItem(own + "unrelated", "keep");
    const changed = vi.fn();
    const event =
      appId === "browser" ? "misty:browser-pins-changed" : "misty:provider-accounts-changed";
    window.addEventListener(event, changed);
    const workspace = useWorkspaceStore.getState().layout;
    try {
      await removeNavigatorPin("one", appId === "chat" ? "social" : appId, item);
      expect(localStorage.getItem(own + key)).toBeNull();
      expect(localStorage.getItem(other + key)).not.toBeNull();
      expect(localStorage.getItem(server + key)).not.toBeNull();
      expect(localStorage.getItem(own + "unrelated")).toBe("keep");
      expect(useAppNavigationStore.getState().providerCache[0].items.map((i) => i.id)).toEqual([
        "pin-keep",
      ]);
      expect(useAppNavigationStore.getState().providerCache[1].items).toEqual([item]);
      expect(changed).toHaveBeenCalledOnce();
      expect(useWorkspaceStore.getState().layout).toBe(workspace);
    } finally {
      window.removeEventListener(event, changed);
    }
  },
);
it("keeps the shortcut when storage fails, and rejects malformed IDs", async () => {
  setup("chat");
  const before = useAppNavigationStore.getState().providerCache;
  vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  await expect(removeNavigatorPin("one", "social", item)).rejects.toThrow("Storage unavailable");
  expect(useAppNavigationStore.getState().providerCache).toBe(before);
  await expect(
    removeNavigatorPin("one", "social", { ...item, route: "/apps/social?pin=../../other" }),
  ).rejects.toThrow("identified");
});
it("does not delete data if the account changes while resolving its server", async () => {
  setup("chat");
  const pending = removeNavigatorPin("one", "social", item);
  useAppsStore.setState({ accountId: "two" });
  await expect(pending).rejects.toThrow("account changed");
});
