import { afterEach, expect, it, vi } from "vitest";
import { defineComponentApp, type MistyAppSDK, type MistyComponentSession } from "@misty/sdk";
import { componentSessionKey, createComponentSessionRegistry } from "./componentSessions";
import { mountAppComponent } from "./component";
import { createAppRpcScope } from "./session";
import { componentLibraries } from "../componentLibraries";
const identity = {
  appId: "code",
  accountId: "account",
  spaceId: "space",
  serverBase: "https://example.test",
  packageHash: "verified-hash",
  scopes: ["files.read"],
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.useRealTimers();
});
function fixture() {
  const sessions = createComponentSessionRegistry({ idleMs: 1000 });
  const closeSession = vi.fn(),
    factory = vi.fn();
  const sdks: MistyAppSDK[] = [];
  const definition = defineComponentApp({
    appId: "code",
    protocol: 2,
    mount: () => {
      throw new Error("Direct fallback should not run");
    },
    createSession: () => {
      factory();
      let count = 0;
      return {
        mount: ({ root, misty }) => {
          sdks.push(misty);
          root.textContent = String(++count);
          return { update() {}, unmount() {} };
        },
        close: closeSession,
      };
    },
  });
  const mount = (id: string, key = componentSessionKey(identity)) => {
    const scope = createAppRpcScope({
      identity: { appId: "code", accountId: "account", spaceId: "space", instanceId: id },
      scopes: [],
      expiresAt: "2099-01-01T00:00:00Z",
      isCurrentAccount: () => true,
    });
    const root = document.createElement("div");
    const mounted = mountAppComponent({
      definition,
      root,
      scope,
      sessionKey: key,
      sessions,
      context: { instanceId: id, route: "/apps/code", active: true, appearance: { mode: "dark" } },
      transport: { request: async () => null },
      release: vi.fn(),
    });
    cleanup.push(mounted.close);
    return { root, mounted, scope };
  };
  cleanup.push(() => sessions.closeAll());
  return { sessions, definition, factory, closeSession, sdks, mount };
}
it("shares app-owned state while keeping SDKs and native authority view-owned", async () => {
  const f = fixture(),
    a = f.mount("a"),
    b = f.mount("b");
  await Promise.all([a.mounted.ready, b.mounted.ready]);
  expect(f.factory).toHaveBeenCalledOnce();
  expect(a.root.textContent).toBe("1");
  expect(b.root.textContent).toBe("2");
  expect(f.sdks[0]).not.toBe(f.sdks[1]);
  await a.mounted.close();
  await expect(f.sdks[0].context.get()).rejects.toMatchObject({ code: "app_closed" });
  await expect(f.sdks[1].context.get()).resolves.toBeNull();
  expect(f.closeSession).not.toHaveBeenCalled();
  await f.sessions.closeAll();
  expect(b.scope.signal.aborted).toBe(true);
  expect(f.closeSession).toHaveBeenCalledOnce();
});
it("keeps an idle session briefly for tab transitions and closes it exactly once afterwards", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    a = f.mount("a");
  await a.mounted.ready;
  await a.mounted.close();
  await vi.advanceTimersByTimeAsync(900);
  const b = f.mount("b");
  await b.mounted.ready;
  expect(b.root.textContent).toBe("2");
  await b.mounted.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.closeSession).toHaveBeenCalledOnce();
  expect(f.sessions.size()).toBe(0);
  const c = f.mount("c");
  await c.mounted.ready;
  expect(c.root.textContent).toBe("1");
});
it("partitions deployment, account, Space, package and granted scopes", async () => {
  const f = fixture();
  const changes = [
    {},
    { serverBase: "https://other.test" },
    { accountId: "other" },
    { spaceId: "other" },
    { packageHash: "new" },
    { scopes: ["files.write"] },
  ];
  for (const [index, change] of changes.entries())
    await f.mount(String(index), componentSessionKey({ ...identity, ...change })).mounted.ready;
  expect(f.factory).toHaveBeenCalledTimes(6);
  expect(componentSessionKey({ ...identity, scopes: ["a", "b", "a"] })).toBe(
    componentSessionKey({ ...identity, scopes: ["b", "a"] }),
  );
});
it("cleans a late session factory after reset without mounting its view", async () => {
  const sessions = createComponentSessionRegistry();
  cleanup.push(() => sessions.closeAll());
  let finish!: (session: MistyComponentSession) => void;
  const definition = defineComponentApp({
    appId: "code",
    protocol: 2,
    mount: vi.fn(),
    createSession: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const invalidate = vi.fn(),
    lease = sessions.acquire("scope", definition, componentLibraries, invalidate);
  const rejected = expect(lease.ready).rejects.toMatchObject({ code: "app_closed" });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await sessions.closeAll();
  const close = vi.fn(),
    mount = vi.fn();
  finish({ close, mount });
  await rejected;
  expect(invalidate).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(mount).not.toHaveBeenCalled();
});
it("does not invoke a session mount after its individual view closed while the factory was loading", async () => {
  const f = fixture();
  let finish!: (session: MistyComponentSession) => void;
  const definition = defineComponentApp({
    ...f.definition,
    createSession: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const scope = createAppRpcScope({
    identity: { appId: "code", accountId: "account", instanceId: "pending" },
    scopes: [],
    expiresAt: "2099-01-01T00:00:00Z",
    isCurrentAccount: () => true,
  });
  const runtime = mountAppComponent({
    definition,
    root: document.createElement("div"),
    scope,
    sessionKey: "pending",
    sessions: f.sessions,
    context: {
      instanceId: "pending",
      route: "/apps/code",
      active: true,
      appearance: { mode: "dark" },
    },
    transport: { request: async () => null },
    release: vi.fn(),
  });
  const rejected = expect(runtime.ready).rejects.toMatchObject({ code: "app_closed" });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  await runtime.close();
  const mount = vi.fn();
  finish({ mount, close: vi.fn() });
  await rejected;
  expect(mount).not.toHaveBeenCalled();
});
it("rejects package mismatches and caps active sessions while evicting idle ones", async () => {
  const f = fixture(),
    registry = createComponentSessionRegistry({ limit: 1, idleMs: 1000 });
  cleanup.push(() => registry.closeAll());
  const first = registry.acquire("a", f.definition, componentLibraries, vi.fn());
  await first.ready;
  expect(() => registry.acquire("a", { ...f.definition }, componentLibraries, vi.fn())).toThrow(
    "package identity",
  );
  expect(() => registry.acquire("b", f.definition, componentLibraries, vi.fn())).toThrow(
    "Too many",
  );
  first.release();
  const next = registry.acquire("b", f.definition, componentLibraries, vi.fn());
  await next.ready;
  expect(registry.size()).toBe(1);
  expect(f.closeSession).toHaveBeenCalledOnce();
});

it("resets idle default sessions even when no App view remains mounted", async () => {
  const { componentSessions } = await import("./componentSessions");
  const { accountScopeResetEvent } = await import("@/features/auth/store/accountEvents");
  cleanup.push(() => componentSessions.closeAll());
  const f = fixture(),
    lease = componentSessions.acquire("idle-default", f.definition, componentLibraries, vi.fn());
  await lease.ready;
  lease.release();
  window.dispatchEvent(new Event(accountScopeResetEvent));
  await vi.waitFor(() => expect(f.closeSession).toHaveBeenCalledOnce());
  expect(componentSessions.size()).toBe(0);
});
