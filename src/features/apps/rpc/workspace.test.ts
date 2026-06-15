import { createMistyAppSDK } from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { createAppRpcScope } from "./session";
import { createAppUiRpc } from "./appUi";
import { createAppUiBackend } from "./appUiBackend";
const scopes: ReturnType<typeof createAppRpcScope>[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.close());
  useWorkspaceStore.getState().reset();
});
function fixture(grants = ["navigation.write"]) {
  useWorkspaceStore.getState().reset();
  const tab = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/apps/planner?space=space-a")!);
  const scope = createAppRpcScope({
    identity: { appId: "planner", accountId: "fixture", spaceId: "space-a", instanceId: tab.id },
    scopes: grants,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  scopes.push(scope);
  const rpc = createAppUiRpc(scope, createAppUiBackend(scope));
  const sdk = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready" ? Promise.resolve() : rpc.request(message),
    subscribe: rpc.subscribe,
  });
  return { sdk, scope, tab };
}
it("opens a separate own-App tab and split panels through the SDK without replacing the caller", async () => {
  const { sdk, tab } = fixture();
  const next = await sdk.workspace.open({ route: "/apps/planner?view=agenda" });
  const pane = dockLeaves(useWorkspaceStore.getState().layout.root).find((item) =>
    item.tabs.some((item) => item.id === tab.id),
  )!;
  expect(pane.tabs.find((item) => item.id === next.viewId)?.route).toBe(
    "/apps/planner?view=agenda&space=space-a",
  );
  expect(pane.tabs.find((item) => item.id === tab.id)?.route).toBe(tab.route);
  const right = await sdk.workspace.open({
    route: "/apps/planner?view=roadmaps",
    placement: "right",
  });
  const panes = dockLeaves(useWorkspaceStore.getState().layout.root);
  expect(panes).toHaveLength(2);
  expect(panes.find((item) => item.tabs.some((item) => item.id === right.viewId))?.id).not.toBe(
    pane.id,
  );
  await sdk.workspace.open({ route: "/apps/planner", placement: "down" });
  await sdk.workspace.open({ route: "/apps/planner", placement: "right" });
  const before = useWorkspaceStore.getState().layout;
  await expect(
    sdk.workspace.open({ route: "/apps/planner", placement: "right" }),
  ).rejects.toMatchObject({ code: "panel_limit" });
  expect(useWorkspaceStore.getState().layout).toBe(before);
});
it("rejects foreign routes, foreign Spaces, missing grants and a removed caller before changing the workspace", async () => {
  const { sdk, tab } = fixture();
  const before = useWorkspaceStore.getState().layout;
  for (const route of [
    "/apps/journal",
    "/apps/planner?space=space-b",
    "/apps/planner?space=space-a&space=space-b",
    "/apps/planner/../../settings",
  ]) {
    await expect(sdk.workspace.open({ route })).rejects.toMatchObject({
      code: "invalid_navigation",
    });
    expect(useWorkspaceStore.getState().layout).toBe(before);
  }
  useWorkspaceStore.getState().closeTab(tab.id);
  await expect(sdk.workspace.open({ route: "/apps/planner" })).rejects.toMatchObject({
    code: "view_closed",
  });
  const denied = fixture([]);
  await expect(denied.sdk.workspace.open({ route: "/apps/planner" })).rejects.toMatchObject({
    code: "capability_denied",
  });
});

it("stores bounded app state separately from host metadata and returns detached snapshots", async () => {
  const { sdk, tab } = fixture();
  useWorkspaceStore.getState().updateTabState(tab.id, { hostSecret: "private", version: 1 });
  expect((await sdk.workspace.snapshot()).views[0].state).toBeNull();
  const state = { viewport: { file: "日本語.ts" }, explorerWidth: 24 };
  await sdk.workspace.update({ viewId: tab.id, state, title: "Editor", sidebarVisible: false });
  state.viewport.file = "mutated after request";
  const snapshot = await sdk.workspace.snapshot();
  expect(snapshot.views[0]).toMatchObject({
    title: "Editor",
    sidebarVisible: false,
    state: { viewport: { file: "日本語.ts" } },
  });
  expect(JSON.stringify(snapshot)).not.toContain("hostSecret");
  const host = dockLeaves(useWorkspaceStore.getState().layout.root)
    .flatMap((pane) => pane.tabs)
    .find((t) => t.id === tab.id)!;
  expect(host.state).toMatchObject({ hostSecret: "private", version: 1 });
  (snapshot.views[0].state as { viewport: { file: string } }).viewport.file = "mutated snapshot";
  expect((await sdk.workspace.snapshot()).views[0].state).toMatchObject({
    viewport: { file: "日本語.ts" },
  });
  await sdk.workspace.update({ viewId: tab.id, state: null });
  expect((await sdk.workspace.snapshot()).views[0].state).toBeNull();
});

it("opens restored state to the left/above, focuses, places and closes only owned views", async () => {
  const { sdk, tab } = fixture();
  const left = await sdk.workspace.open({
    route: "/apps/planner",
    placement: "left",
    state: { mode: "calendar" },
    title: "Calendar",
    sidebarVisible: false,
  });
  const up = await sdk.workspace.open({ route: "/apps/planner", placement: "up" });
  expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(3);
  expect(
    (await sdk.workspace.snapshot()).views.find((view) => view.viewId === left.viewId),
  ).toMatchObject({ title: "Calendar", state: { mode: "calendar" }, sidebarVisible: false });
  await sdk.workspace.focus(tab.id);
  expect(
    (await sdk.workspace.snapshot()).views.find((view) => view.viewId === tab.id)?.focused,
  ).toBe(true);
  await sdk.workspace.place({ viewId: up.viewId, targetViewId: left.viewId, placement: "tab" });
  const grouped = (await sdk.workspace.snapshot()).views;
  expect(grouped.find((view) => view.viewId === up.viewId)?.panelId).toBe(
    grouped.find((view) => view.viewId === left.viewId)?.panelId,
  );
  expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
  await sdk.workspace.close(up.viewId);
  expect((await sdk.workspace.snapshot()).views.map((view) => view.viewId)).not.toContain(
    up.viewId,
  );
  expect((await sdk.workspace.snapshot()).views.map((view) => view.viewId)).toContain(tab.id);
});

it("rejects foreign views, foreign Spaces and host fields without changing the workspace", async () => {
  const { sdk, tab } = fixture();
  const foreign = useWorkspaceStore
    .getState()
    .addSurface(workspaceSurfaceFromRoute("/apps/journal?space=space-a")!);
  const otherSpaceRequest = workspaceSurfaceFromRoute("/apps/planner?space=space-b")!;
  const otherSpace = useWorkspaceStore
    .getState()
    .addSurface({ ...otherSpaceRequest, scopeKey: undefined, forceNew: true });
  const before = useWorkspaceStore.getState().layout;
  for (const viewId of [foreign.id, otherSpace.id, "missing"]) {
    await expect(sdk.workspace.focus(viewId)).rejects.toMatchObject({ code: "view_not_owned" });
    await expect(sdk.workspace.close(viewId)).rejects.toMatchObject({ code: "view_not_owned" });
    await expect(sdk.workspace.update({ viewId, state: null })).rejects.toMatchObject({
      code: "view_not_owned",
    });
    await expect(
      sdk.workspace.place({ viewId: tab.id, targetViewId: viewId, placement: "right" }),
    ).rejects.toMatchObject({ code: "view_not_owned" });
  }
  await expect(
    sdk.workspace.update({ viewId: tab.id, route: "/settings" } as never),
  ).rejects.toThrow();
  expect(useWorkspaceStore.getState().layout).toBe(before);
  expect((await sdk.workspace.snapshot()).views.map((view) => view.viewId)).toEqual([tab.id]);
});

it("coalesces owned updates and stops workspace events on unsubscribe or scope closure", async () => {
  const { sdk, tab, scope } = fixture();
  const changed = vi.fn(),
    stop = await sdk.workspace.subscribe(changed);
  useWorkspaceStore.getState().updateTabState(tab.id, { privateHostState: true });
  await Promise.resolve();
  expect(changed).not.toHaveBeenCalled();
  await sdk.workspace.update({
    viewId: tab.id,
    title: "Changed",
    state: { selected: 1 },
    sidebarVisible: false,
  });
  await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(changed.mock.calls[0][0].views[0]).toMatchObject({
    title: "Changed",
    state: { selected: 1 },
    sidebarVisible: false,
  });
  stop();
  await sdk.workspace.update({ viewId: tab.id, title: "Quiet" });
  expect(changed).toHaveBeenCalledTimes(1);
  const late = vi.fn();
  await sdk.workspace.subscribe(late);
  useWorkspaceStore.getState().renameTab(tab.id, "Pending notification");
  scope.close();
  await Promise.resolve();
  expect(late).not.toHaveBeenCalled();
});

it("denies missing navigation grants and control after the caller closes", async () => {
  const denied = fixture([]);
  await expect(denied.sdk.workspace.snapshot()).rejects.toMatchObject({
    code: "capability_denied",
  });
  await expect(denied.sdk.workspace.subscribe(vi.fn())).rejects.toMatchObject({
    code: "capability_denied",
  });
  await expect(
    denied.sdk.workspace.update({ viewId: denied.tab.id, title: "No" }),
  ).rejects.toMatchObject({ code: "capability_denied" });
  const { sdk, tab } = fixture();
  const peer = await sdk.workspace.open({ route: "/apps/planner" });
  await sdk.workspace.close(tab.id);
  await expect(sdk.workspace.snapshot()).rejects.toMatchObject({ code: "view_closed" });
  await expect(sdk.workspace.focus(peer.viewId)).rejects.toMatchObject({ code: "view_closed" });
});

it("suppresses queued workspace events and control after leaving the calling Space", async () => {
  const { sdk, tab } = fixture();
  const changed = vi.fn();
  await sdk.workspace.subscribe(changed);
  useWorkspaceStore.getState().renameTab(tab.id, "Queued");
  useWorkspaceStore.getState().setScope("space:space-b");
  await Promise.resolve();
  expect(changed).not.toHaveBeenCalled();
  await expect(sdk.workspace.snapshot()).rejects.toMatchObject({ code: "view_closed" });
  await expect(sdk.workspace.update({ viewId: tab.id, state: null })).rejects.toMatchObject({
    code: "view_closed",
  });
});

it("refuses additional split placement at the host's panel limit without changing layout", async () => {
  const { sdk, tab } = fixture();
  const next = await sdk.workspace.open({ route: "/apps/planner", placement: "left" });
  await sdk.workspace.open({ route: "/apps/planner", placement: "up" });
  await sdk.workspace.open({ route: "/apps/planner", placement: "down" });
  const before = useWorkspaceStore.getState().layout;
  await expect(
    sdk.workspace.place({ viewId: next.viewId, targetViewId: tab.id, placement: "right" }),
  ).rejects.toMatchObject({ code: "panel_limit" });
  expect(useWorkspaceStore.getState().layout).toBe(before);
});

it("shares monotonic snapshot revisions across live views of the same app", async () => {
  const { sdk, scope } = fixture();
  const initial = await sdk.workspace.snapshot();
  const opened = await sdk.workspace.open({ route: "/apps/planner" });
  const peerScope = createAppRpcScope({
    identity: { ...scope.identity, instanceId: opened.viewId },
    scopes: ["navigation.write"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  scopes.push(peerScope);
  const peerRpc = createAppUiRpc(peerScope, createAppUiBackend(peerScope));
  const peer = createMistyAppSDK({
    request: (message) =>
      message.method === "lifecycle.ready" ? Promise.resolve() : peerRpc.request(message),
  });
  const next = await sdk.workspace.snapshot();
  expect(next.revision).toBeGreaterThan(initial.revision);
  expect((await peer.workspace.snapshot()).revision).toBe(next.revision);
  scope.close();
  await peer.workspace.update({ viewId: opened.viewId, title: "Peer remains" });
  expect((await peer.workspace.snapshot()).revision).toBeGreaterThan(next.revision);
});
