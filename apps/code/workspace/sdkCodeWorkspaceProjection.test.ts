import { createMistyAppSDK } from "@misty/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockLeaves } from "@/features/workspace/dockTree";
import { createCodeTabState, parseCodeTabState } from "@/features/workspace/model";
import { workspaceSurfaceFromRoute } from "@/features/workspace/routeSurface";
import { createAppRpcScope } from "@/features/apps/rpc/session";
import { createAppUiRpc } from "@/features/apps/rpc/appUi";
import { createAppUiBackend } from "@/features/apps/rpc/appUiBackend";
import { createSdkCodeWorkspaceProjection } from "./sdkCodeWorkspaceProjection";

const disposals: Array<() => void> = [];
afterEach(() => {
  disposals.splice(0).forEach((close) => close());
  useWorkspaceStore.getState().reset();
});
async function fixture() {
  useWorkspaceStore.getState().reset();
  const tab = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/apps/code?space=space-a")!);
  const scope = createAppRpcScope({
    identity: { appId: "code", accountId: "account", spaceId: "space-a", instanceId: tab.id },
    scopes: ["navigation.write"],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const rpc = createAppUiRpc(scope, createAppUiBackend(scope));
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> =>
    message.method === "lifecycle.ready" ? null : rpc.request(message),
  );
  const subscribe = vi.fn(rpc.subscribe);
  const sdk = createMistyAppSDK({ request, subscribe });
  await sdk.workspace.update({
    viewId: tab.id,
    state: createCodeTabState({ rootPath: "/misty-project/test" }) as never,
  });
  const report = vi.fn();
  const projection = createSdkCodeWorkspaceProjection(sdk, {
    viewId: tab.id,
    spaceId: "space-a",
    signal: scope.signal,
    report,
  });
  disposals.push(() => {
    projection.close();
    scope.close();
    rpc.close();
  });
  await projection.ready;
  const current = () =>
    dockLeaves(projection.store.getState().layout.root)
      .flatMap((pane) => pane.tabs)
      .find((view) => view.id === tab.id)!;
  return { tab, scope, rpc, sdk, request, projection, current, report, subscribe };
}

it("projects real owned host views and creates a tab using its acknowledged SDK ID", async () => {
  const f = await fixture();
  const next = await f.projection.store.getState().openSurface({
    surfaceId: "code",
    groupKey: "tool:code",
    route: "/apps/code",
    title: "Other file",
    instancePolicy: "multiple",
    state: createCodeTabState({
      rootPath: "/misty-project/test",
      activeFilePath: "/misty-project/test/a.ts",
    }),
  });
  expect(
    (await f.sdk.workspace.snapshot()).views.find((view) => view.viewId === next.id),
  ).toMatchObject({ title: "Other file" });
  expect(parseCodeTabState(next.state).viewport).toEqual({
    kind: "file",
    activeFilePath: "/misty-project/test/a.ts",
  });
  expect(dockLeaves(f.projection.store.getState().layout.root)[0].tabs).toHaveLength(2);
  f.projection.store
    .getState()
    .dockTab(next.id, dockLeaves(f.projection.store.getState().layout.root)[0].id, "right");
  await f.projection.settled();
  expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(2);
  f.projection.store.getState().focusTab(f.tab.id);
  await f.projection.settled();
  expect(
    (await f.sdk.workspace.snapshot()).views.find((view) => view.viewId === f.tab.id)?.focused,
  ).toBe(true);
  f.projection.store.getState().closeTab(next.id);
  await f.projection.settled();
  expect(dockLeaves(f.projection.store.getState().layout.root)[0].tabs).toHaveLength(1);
});

it("ignores a delayed snapshot after a newer event has arrived", async () => {
  const f = await fixture(),
    original = f.request.getMockImplementation()!;
  let release!: () => void;
  f.request.mockImplementationOnce(async (message) => {
    const value = await original(message);
    await new Promise<void>((done) => {
      release = done;
    });
    return value;
  });
  const reading = f.projection.refresh();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await f.sdk.workspace.update({ viewId: f.tab.id, title: "Newer event" });
  await vi.waitFor(() => expect(f.current().title).toBe("Newer event"));
  release();
  await reading;
  expect(f.current().title).toBe("Newer event");
});

it("keeps rapid local edits visible while serializing their SDK writes", async () => {
  const f = await fixture(),
    original = f.request.getMockImplementation()!;
  const releases: Array<() => void> = [];
  f.request.mockImplementation(async (message) => {
    if (message.method === "workspace.update")
      await new Promise<void>((resolve) => releases.push(resolve));
    return original(message);
  });
  const first = createCodeTabState({
    ...parseCodeTabState(f.current().state),
    activeFilePath: "/misty-project/test/new.ts",
    viewport: { kind: "file", activeFilePath: "/misty-project/test/new.ts" },
  });
  f.projection.store.getState().updateTabState(f.tab.id, first);
  const second = createCodeTabState({ ...parseCodeTabState(f.current().state), explorerWidth: 35 });
  f.projection.store.getState().updateTabState(f.tab.id, second);
  expect(parseCodeTabState(f.current().state)).toMatchObject({
    explorerWidth: 35,
    viewport: { activeFilePath: "/misty-project/test/new.ts" },
  });
  await vi.waitFor(() => expect(releases).toHaveLength(1));
  releases[0]();
  await vi.waitFor(() => expect(releases).toHaveLength(2));
  expect(parseCodeTabState(f.current().state).explorerWidth).toBe(35);
  releases[1]();
  await f.projection.settled();
  expect((await f.sdk.workspace.snapshot()).views[0].state).toMatchObject({
    explorerWidth: 35,
    viewport: { activeFilePath: "/misty-project/test/new.ts" },
  });
});

it("rolls back a failed mutation without discarding the following successful edit", async () => {
  const f = await fixture(),
    original = f.request.getMockImplementation()!;
  let updates = 0;
  f.request.mockImplementation((message) =>
    message.method === "workspace.update" && ++updates === 1
      ? Promise.reject(new Error("Failed write"))
      : original(message),
  );
  f.projection.store.getState().renameTab(f.tab.id, "Failed title");
  f.projection.store.getState().renameTab(f.tab.id, "Final title");
  await f.projection.settled();
  expect(f.current().title).toBe("Final title");
  expect(f.report).toHaveBeenCalledTimes(1);
  expect((await f.sdk.workspace.snapshot()).views[0].title).toBe("Final title");
});

it("stops queued writes and late UI updates when its owning projection closes", async () => {
  const f = await fixture(),
    original = f.request.getMockImplementation()!;
  let release!: () => void;
  f.request.mockImplementationOnce(async (message) => {
    await new Promise<void>((done) => {
      release = done;
    });
    return original(message);
  });
  f.projection.store.getState().renameTab(f.tab.id, "In flight");
  f.projection.store.getState().renameTab(f.tab.id, "Must not be sent");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  f.projection.close();
  release();
  await f.projection.settled();
  expect(dockLeaves(f.projection.store.getState().layout.root)[0].tabs).toHaveLength(0);
  expect((await f.sdk.workspace.snapshot()).views[0].title).toBe("In flight");
  expect(f.report).not.toHaveBeenCalled();
  expect(() => f.projection.store.getState().focusTab(f.tab.id)).toThrow("closed");
});

it("does not project foreign apps or use the workspace methods to bypass companion-app checks", async () => {
  const f = await fixture();
  const foreign = useWorkspaceStore
    .getState()
    .addSurface(workspaceSurfaceFromRoute("/apps/journal?space=space-a")!);
  await f.projection.refresh();
  expect(
    dockLeaves(f.projection.store.getState().layout.root)
      .flatMap((pane) => pane.tabs)
      .map((tab) => tab.id),
  ).not.toContain(foreign.id);
  expect(() => f.projection.store.getState().focusTab(foreign.id)).toThrow("no longer open");
  await expect(
    f.projection.store.getState().openSurface({
      surfaceId: "official-app",
      groupKey: "app:terminal",
      title: "Terminal",
      route: "/apps/terminal",
    }),
  ).rejects.toThrow("cannot be opened");
});

it("releases a subscription acquired after its owning view closes", async () => {
  const f = await fixture();
  const original = f.subscribe.getMockImplementation()!;
  let release!: () => void;
  const unsubscribe = vi.fn();
  f.subscribe.mockImplementationOnce(async (...args) => {
    const remove = await original(...args);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      unsubscribe();
      remove();
    };
  });
  const controller = new AbortController();
  const projection = createSdkCodeWorkspaceProjection(f.sdk, {
    viewId: f.tab.id,
    spaceId: "space-a",
    signal: controller.signal,
    report: f.report,
  });
  const ready = expect(projection.ready).rejects.toThrow("closed");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  controller.abort();
  release();
  await ready;
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(dockLeaves(projection.store.getState().layout.root)[0].tabs).toHaveLength(0);
  expect(f.report).not.toHaveBeenCalled();
});

it("closes its projection after closing the owning host view without reading a dead scope", async () => {
  const f = await fixture();
  f.projection.store.getState().closeTab(f.tab.id);
  await f.projection.settled();
  expect(dockLeaves(f.projection.store.getState().layout.root)[0].tabs).toHaveLength(0);
  expect(
    dockLeaves(useWorkspaceStore.getState().layout.root)
      .flatMap((pane) => pane.tabs)
      .some((tab) => tab.id === f.tab.id),
  ).toBe(false);
  expect(f.report).not.toHaveBeenCalled();
});

it("cancels prepared native access when the host rejects view creation", async () => {
  const f = await fixture(),
    original = f.request.getMockImplementation()!;
  const cancel = vi.fn(async () => undefined);
  const projection = createSdkCodeWorkspaceProjection(f.sdk, {
    viewId: f.tab.id,
    spaceId: "space-a",
    signal: f.scope.signal,
    report: f.report,
    prepareOpen: async (state) => ({ state, cancel }),
  });
  disposals.push(projection.close);
  await projection.ready;
  f.request.mockImplementation((message) =>
    message.method === "workspace.open"
      ? Promise.reject(new Error("Panel limit"))
      : original(message),
  );
  await expect(
    projection.store
      .getState()
      .openSurface({
        surfaceId: "code",
        groupKey: "tool:code",
        title: "New",
        route: "/apps/code",
        state: createCodeTabState(),
      }),
  ).rejects.toThrow("Panel limit");
  expect(cancel).toHaveBeenCalledTimes(1);
});
