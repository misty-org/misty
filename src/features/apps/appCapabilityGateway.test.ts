import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficialApp, OfficialAppSession } from "@/api/apps";
import {
  AppCapabilityError,
  executeAppCapability,
  type AppCapabilityContext,
} from "./appCapabilityGateway";

const app: OfficialApp = {
  id: "journal",
  app_id: "com.misty.journal",
  slug: "journal",
  name: "Journal",
  publisher: "Misty",
  description: "Notes and drawings.",
  version: "1.0.0",
  permission_version: 1,
  minimum_host_protocol: 2,
  official: true,
  age_rating: "4+",
  scopes: ["notes.read", "storage.read", "storage.write", "navigation.write", "ui.toast"],
  desktop: { runtime: "hosted" },
  mobile: { runtime: "hosted" },
};

const session: OfficialAppSession = {
  token: "x".repeat(43),
  app_id: "journal",
  space_id: "space-1",
  scopes: ["notes.read", "storage.read", "storage.write", "navigation.write", "ui.toast"],
  expires_at: "2099-01-01T00:00:00Z",
  sdk_base_url: "/app-runtime",
};

const context: AppCapabilityContext = {
  app,
  session,
  serverBase: "https://api.mistysys.com/v1",
  user: { id: "user-1", name: "Misty User", email: "user@example.com" },
  space: { id: "space-1", name: "Research", role: "owner", permissions: {} } as never,
  platform: "desktop",
};

describe("App capability gateway", () => {
  it("routes named SDK methods through the shared RPC endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"notes":[]}'));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(executeAppCapability(context, "notes.list", {})).resolves.toEqual({ notes: [] });
      const [url, init] = fetcher.mock.calls[0];
      expect(String(url)).toBe("https://api.mistysys.com/v1/app-runtime/rpc");
      expect(JSON.parse(init.body)).toEqual({ protocol: 2, method: "notes.list", params: {} });
      expect(init.headers.Authorization).toBe(`Bearer ${session.token}`);
      await expect(
        executeAppCapability(context, "notes.get", { path: { noteID: "../me" } }),
      ).rejects.toMatchObject({ code: "invalid_params" });
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects expired or mismatched registrations before any capability runs", async () => {
    for (const change of [
      { app_id: "another" },
      { space_id: "another" },
      { expires_at: "2000-01-01T00:00:00Z" },
      { expires_at: "invalid" },
    ]) {
      await expect(
        executeAppCapability({ ...context, session: { ...session, ...change } }, "context.get", {}),
      ).rejects.toBeInstanceOf(AppCapabilityError);
    }
  });
  it("does not disclose Space metadata without a declared and granted Space scope", async () => {
    expect(await executeAppCapability(context, "context.get", {})).not.toHaveProperty(
      "space",
      expect.any(Object),
    );
    const allowed = {
      ...context,
      app: { ...app, scopes: [...app.scopes, "spaces.read"] },
      session: { ...session, scopes: [...session.scopes, "spaces.read"] },
    };
    expect(await executeAppCapability(allowed, "context.get", {})).toMatchObject({
      space: { id: "space-1", name: "Research" },
    });
  });
  it("opens only the owning App's granted native surface and ignores requested identities", async () => {
    const openNativeSurface = vi.fn();
    const native: AppCapabilityContext = {
      ...context,
      app: { ...app, id: "browser", scopes: ["browser.navigate"] },
      session: { ...session, app_id: "browser", scopes: ["browser.navigate"] },
      tab: { id: "browser-tab", groupKey: "app:browser" } as never,
      openNativeSurface,
    };
    await expect(
      executeAppCapability(native, "native.surface.open", {
        appId: "terminal",
        command: "arbitrary",
      }),
    ).resolves.toEqual({ surface: "browser" });
    expect(openNativeSurface).toHaveBeenCalledWith("browser");
    for (const denied of [
      { ...native, session: { ...native.session, scopes: [] } },
      { ...native, session: { ...native.session, app_id: "terminal" } },
      { ...native, app: { ...native.app, scopes: [] } },
      { ...native, app: { ...native.app, official: false } },
      { ...native, tab: { ...native.tab, groupKey: "app:terminal" } },
      { ...native, openNativeSurface: undefined },
    ]) {
      openNativeSurface.mockClear();
      await expect(
        executeAppCapability(denied as AppCapabilityContext, "native.surface.open", {}),
      ).rejects.toBeInstanceOf(AppCapabilityError);
      expect(openNativeSurface).not.toHaveBeenCalled();
    }
  });

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("derives identity and context from the trusted host registry", async () => {
    await expect(executeAppCapability(context, "context.get", {})).resolves.toMatchObject({
      appId: "com.misty.journal",
      slug: "journal",
      space: undefined,
    });
  });

  it("namespaces local storage by deployment, account and immutable App identity", async () => {
    await executeAppCapability(context, "storage.local.set", {
      key: "draft",
      value: { title: "One" },
    });
    await expect(
      executeAppCapability(context, "storage.local.get", { key: "draft" }),
    ).resolves.toEqual({ title: "One" });
    for (const alternate of [
      { ...context, serverBase: "https://other.example/v1" },
      { ...context, serverBase: "https://api.mistysys.com/other" },
      { ...context, user: { ...context.user, id: "user-2" } },
    ]) {
      await expect(
        executeAppCapability(alternate, "storage.local.get", { key: "draft" }),
      ).resolves.toBeNull();
      await expect(executeAppCapability(alternate, "storage.local.keys", {})).resolves.toEqual([]);
    }
    await expect(
      executeAppCapability(
        { ...context, serverBase: `${context.serverBase}/` },
        "storage.local.get",
        { key: "draft" },
      ),
    ).resolves.toEqual({ title: "One" });
    await expect(
      executeAppCapability(
        {
          ...context,
          app: { ...app, id: "planner", app_id: "com.misty.planner", slug: "planner" },
          session: { ...session, app_id: "planner" },
        },
        "storage.local.get",
        { key: "draft" },
      ),
    ).resolves.toBeNull();
  });

  it("rejects navigation outside the owning App", async () => {
    await expect(
      executeAppCapability(context, "navigation.open", { route: "/apps/files" }),
    ).rejects.toMatchObject({ code: "invalid_navigation" });
  });

  it("binds routes to the calling Space, including nested navigation items", async () => {
    const navigate = vi.fn();
    await executeAppCapability({ ...context, navigate }, "navigation.open", {
      route: "/apps/journal?view=notes#selection",
    });
    expect(navigate).toHaveBeenCalledWith("/apps/journal?view=notes&space=space-1#selection");
    for (const route of ["/apps/journal?space=other", "/apps/journal?space=space-1&space=other"]) {
      await expect(
        executeAppCapability({ ...context, navigate }, "navigation.open", { route }),
      ).rejects.toMatchObject({ code: "invalid_navigation" });
      await expect(
        executeAppCapability(context, "navigation.setItems", {
          items: [
            {
              id: "root",
              label: "Root",
              route: "/apps/journal",
              children: [{ id: "child", label: "Child", route }],
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "invalid_navigation" });
    }
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("publishes only sanitized declarative navigation", async () => {
    const receive = vi.fn();
    window.addEventListener("misty:app-navigation", receive, { once: true });
    await executeAppCapability(context, "navigation.setItems", {
      items: [{ id: "notes", label: "Notes", route: "/apps/journal/notes?space=space-1" }],
    });
    expect(receive).toHaveBeenCalledOnce();
    expect((receive.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      appId: "journal",
      items: [{ id: "notes", label: "Notes", route: "/apps/journal/notes?space=space-1" }],
    });
  });

  it("fails closed for unknown methods", async () => {
    await expect(executeAppCapability(context, "host.invoke", {})).rejects.toMatchObject({
      code: "unsupported_method",
    });
  });

  it("stops cancelled requests before side effects and forwards cancellation to HTTP", async () => {
    const abort = new AbortController();
    const fetchRequest = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await executeAppCapability({ ...context, signal: abort.signal }, "official.http", {
      path: "/spaces/space-1",
    });
    expect(fetchRequest.mock.calls[0]?.[1]?.signal).toBe(abort.signal);
    abort.abort();
    await expect(
      executeAppCapability({ ...context, signal: abort.signal }, "storage.local.set", {
        key: "cancelled",
        value: true,
      }),
    ).rejects.toThrow();
    await expect(
      executeAppCapability(context, "storage.local.get", { key: "cancelled" }),
    ).resolves.toBeNull();
  });

  it("keeps the App token in the host while proxying official compatibility traffic", async () => {
    const fetchRequest = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = (await executeAppCapability(context, "official.http", {
      path: "/spaces/space-1",
      method: "GET",
      headers: [["Accept", "application/json"]],
    })) as { status: number; body: ArrayBuffer };

    const [target, init] = fetchRequest.mock.calls[0] ?? [];
    expect(String(target)).toBe("https://api.mistysys.com/v1/spaces/space-1");
    expect((init?.headers as Headers).get("Authorization")).toBe(`Bearer ${session.token}`);
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.body)).toBe(JSON.stringify({ ok: true }));
  });

  it("requires a capability to be both declared and granted", async () => {
    await expect(
      executeAppCapability(
        { ...context, app: { ...app, scopes: ["storage.read"] } },
        "storage.local.set",
        { key: "draft", value: true },
      ),
    ).rejects.toMatchObject({ code: "capability_undeclared" });

    await expect(
      executeAppCapability(
        { ...context, session: { ...session, scopes: ["storage.read"] } },
        "navigation.open",
        { route: "/apps/journal" },
      ),
    ).rejects.toMatchObject({ code: "capability_denied" });
  });
});
