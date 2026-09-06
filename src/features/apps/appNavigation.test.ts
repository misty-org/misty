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
  useAppNavigationStore.setState({ entries: [] });
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
