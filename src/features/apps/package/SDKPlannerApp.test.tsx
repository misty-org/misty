import { act } from "react";
import { within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { isMistyServerMethod, type MistyComponentContext } from "@misty/sdk";
import definition from "./SDKPlannerApp";
import { mountAppComponent } from "../rpc/component";
import { createAppRpcScope } from "../rpc/session";
import { createServerRpc } from "../rpc/server";
import { createAppUiRpc } from "../rpc/appUi";
import { createAppSurfaceBridge } from "../rpc/surface";
import { subscribeAppDataChanges } from "../rpc/dataEvents";
import { executeAppCapability, type AppCapabilityContext } from "../appCapabilityGateway";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await act(close);
  document.body.innerHTML = "";
});

function fixture(spaceId: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const grants = [
    "spaces.read",
    "tasks.read",
    "tasks.write",
    "calendar.read",
    "calendar.write",
    "roadmaps.read",
    "roadmaps.write",
    "connections.read",
    "connections.write",
    "storage.read",
    "storage.write",
    "navigation.write",
    "ai.use",
  ];
  const scope = createAppRpcScope({
    identity: { appId: "planner", accountId: "user-a", spaceId, instanceId: `tab-${spaceId}` },
    scopes: grants,
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const space = {
    id: spaceId,
    security_domain_id: "security-a",
    owner_user_id: "user-a",
    name: spaceId,
    is_default: false,
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: false,
    permissions: { "tasks.manage": true },
    created_at: "2026-09-05T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
  };
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { method } = JSON.parse(String(init?.body));
    const results: Record<string, unknown> = {
      "spaces.get": space,
      "spaces.members.list": { members: [], agents: [] },
      "tasks.list": { tasks: [], status_totals: null },
      "agenda.list": { entries: [] },
      "calendar.sources.list": { sources: [] },
      "integrations.list": { integrations: [] },
      "connections.list": { connections: [] },
      "roadmaps.list": { roadmaps: [] },
    };
    if (!(method in results)) throw new Error(`Unexpected server method: ${method}`);
    return new Response(JSON.stringify(results[method]));
  });
  const server = createServerRpc(scope, {
    serverBase: "https://fixture.example/v1",
    fetch: fetcher,
    readAppSession: () => ({ appId: "planner", spaceId, token: "host-only" }),
  });
  const errors: string[] = [];
  const setTitle = vi.fn();
  const ui = createAppUiRpc(scope, {
    settings: () => ({}),
    setTitle,
    subscribeSettings: () => () => {},
    registerShortcut: () => () => {},
    subscribeData: (domain, listener) => subscribeAppDataChanges(scope, domain, listener),
    openExternal: async () => {},
    confirm: async () => false,
    reportError: (error) => errors.push(error),
  });
  const surfaces = createAppSurfaceBridge(scope, () => {});
  const context: MistyComponentContext = {
    instanceId: `tab-${spaceId}`,
    active: true,
    focused: true,
    route: `/apps/planner?space=${spaceId}&view=tasks&taskView=list`,
    appearance: { mode: "dark" },
  };
  const capability: AppCapabilityContext = {
    app: {
      id: "planner",
      app_id: "com.misty.planner",
      slug: "planner",
      version: "1.1.0",
      name: "Planner",
      publisher: "Misty",
      description: "Planner",
      permission_version: 4,
      minimum_host_protocol: 2,
      official: true,
      age_rating: "4+",
      scopes: grants,
      desktop: { runtime: "downloaded" },
      mobile: { runtime: "unsupported" },
    },
    user: { id: "user-a", name: "User", email: "hidden@example.com" },
    session: {
      app_id: "planner",
      space_id: spaceId,
      scopes: grants,
      token: "host-only",
      expires_at: "2099-01-01T00:00:00Z",
      sdk_base_url: "/app-runtime",
    },
    space: space as AppCapabilityContext["space"],
    serverBase: "https://fixture.example/v1",
    platform: "desktop",
    navigate: vi.fn(),
    signal: scope.signal,
  };
  const mounted = mountAppComponent({
    definition,
    root,
    context,
    scope,
    transport: {
      registerSurface: surfaces.register,
      subscribe: ui.subscribe,
      request(message) {
        if (message.method === "lifecycle.ready") return Promise.resolve();
        if (isMistyServerMethod(message.method)) return server.request(message);
        if (
          message.method === "context.get" ||
          message.method.startsWith("storage.") ||
          message.method.startsWith("navigation.")
        )
          return executeAppCapability(capability, message.method, message.params);
        return ui.request(message);
      },
    },
    release: () => {
      ui.close();
      server.close();
      surfaces.close();
    },
  });
  cleanups.push(async () => {
    await mounted.close();
    root.remove();
  });
  return { mounted, root, context, errors, fetcher, scope, setTitle };
}

it("mounts the complete SDK app, switches all three sections, and tears down one Space independently", async () => {
  let a!: ReturnType<typeof fixture>, b!: ReturnType<typeof fixture>;
  await act(async () => {
    a = fixture("space-a");
    b = fixture("space-b");
    await Promise.all([a.mounted.ready, b.mounted.ready]);
  });
  await within(a.root).findByRole("heading", { name: "Tasks" });
  await within(b.root).findByRole("heading", { name: "Tasks" });
  await act(async () =>
    a.mounted.update({
      ...a.context,
      route: "/apps/planner?space=space-a&view=agenda&agendaView=month",
    }),
  );
  await within(a.root).findByRole("main", { name: "month agenda" });
  expect(within(b.root).getByRole("heading", { name: "Tasks" })).toBeTruthy();
  await act(async () =>
    a.mounted.update({ ...a.context, route: "/apps/planner?space=space-a&view=roadmaps" }),
  );
  await within(a.root).findByRole("heading", { name: "My Roadmaps" });
  expect(a.root.querySelector("iframe")).toBeNull();
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  expect(
    a.fetcher.mock.calls.every(
      ([, init]) =>
        JSON.parse(String(init?.body)).params.path?.spaceID === "space-a" ||
        JSON.parse(String(init?.body)).method === "connections.list",
    ),
  ).toBe(true);
  await act(async () => a.mounted.close());
  expect(a.root.childElementCount).toBe(0);
  const before = b.fetcher.mock.calls.length;
  await act(async () =>
    window.dispatchEvent(
      new CustomEvent("misty:space-coordination-event", {
        detail: { space_id: "space-b", type: "task.updated" },
      }),
    ),
  );
  await waitFor(() => expect(b.fetcher.mock.calls.length).toBeGreaterThan(before));
  expect(b.scope.signal.aborted).toBe(false);
});
