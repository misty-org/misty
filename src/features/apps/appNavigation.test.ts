import { afterEach, expect, it } from "vitest";
import {
  appNavigationFor,
  createAppNavigationRegistration,
  useAppNavigationStore,
} from "./appNavigation";
import { createAppRpcScope } from "./rpc/session";
const scopes: ReturnType<typeof createAppRpcScope>[] = [];
const makeScope = (instanceId: string, spaceId = "one") => {
  const scope = createAppRpcScope({
    identity: { appId: "planner", accountId: "account", spaceId, instanceId },
    scopes: ["navigation.write"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  scopes.push(scope);
  return scope;
};
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.close());
  useAppNavigationStore.setState({ entries: [], providerCache: [] });
});
it("prefers the focused instance, isolates Spaces and retains the surviving registration", () => {
  const a = makeScope("a"),
    b = makeScope("b"),
    other = makeScope("other", "two");
  const first = createAppNavigationRegistration(a),
    second = createAppNavigationRegistration(b);
  const item = { id: "tasks", label: "Tasks A", route: "/apps/planner?space=one" };
  first.setItems([item]);
  item.label = "Changed after registration";
  second.setItems([{ ...item, label: "Tasks B" }]);
  createAppNavigationRegistration(other).setItems([{ ...item, label: "Other Space" }]);
  const selected = () =>
    appNavigationFor(useAppNavigationStore.getState().entries, {
      accountId: "account",
      appId: "planner",
      spaceId: "one",
      instanceId: "a",
    });
  expect(selected()?.items[0].label).toBe("Tasks A");
  a.close();
  expect(selected()?.items[0].label).toBe("Tasks B");
  expect(() => first.setItems([item])).toThrow("closed");
  second.setItems([]);
  expect(selected()).toBeUndefined();
  expect(useAppNavigationStore.getState().entries).toHaveLength(1);
});

it("retains provider shortcuts when a view closes, scoped to the account and Space", async () => {
  const { savedProviderNavigation } = await import("./appNavigation");
  const scope = createAppRpcScope({
    identity: { appId: "inbox", accountId: "mail-user", instanceId: "mail-tab" },
    scopes: ["navigation.write"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const items = [
    { id: "integrations", label: "Integrations", route: "/apps/inbox" },
    { id: "google", label: "Gmail", route: "/apps/inbox?provider=google" },
  ];
  createAppNavigationRegistration(scope).setItems(items);
  scope.close();
  const cached = useAppNavigationStore.getState().providerCache;
  expect(
    savedProviderNavigation(cached, { accountId: "mail-user", appId: "inbox" })?.items,
  ).toEqual(items);
  expect(
    savedProviderNavigation(cached, { accountId: "other-user", appId: "inbox" }),
  ).toBeUndefined();
  expect(
    savedProviderNavigation(cached, {
      accountId: "mail-user",
      appId: "inbox",
      spaceId: "other-space",
    }),
  ).toBeUndefined();
  useAppNavigationStore.setState({ providerCache: [] });
});

it.each(["browser", "chat", "inbox", "planner", "journal", "library", "agents"])(
  "retains %s destinations without a gallery navigation row",
  (appId) => {
    const scope = createAppRpcScope({
      identity: { appId, accountId: "test", instanceId: "tab" },
      scopes: ["navigation.write"],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const items = [{ id: "misty", label: "Misty", route: `/apps/${appId}?provider=misty` }];
    createAppNavigationRegistration(scope).setItems(items);
    scope.close();
    expect(
      useAppNavigationStore.getState().providerCache.find((entry) => entry.identity.appId === appId)
        ?.items,
    ).toEqual(items);
  },
);
