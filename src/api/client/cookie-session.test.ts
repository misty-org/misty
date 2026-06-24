import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ enabled: false, fetch: vi.fn(), invoke: vi.fn() }));
vi.mock("./native-account-fetch", () => ({ nativeAccountFetch: native.fetch }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => "https://misty.example/v1",
  resolveHostedApiBase: () => "https://misty.example/v1",
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => native.enabled }));

describe("JWT cookie transport", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    native.enabled = false;
    native.fetch.mockReset();
    native.invoke.mockReset().mockResolvedValue("account-a");
  });

  it("uses the same native cookie jar for desktop login, /me, refresh, and retry", async () => {
    native.enabled = true;
    const browserFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Account request bypassed native cookies"));
    let refreshed = false;
    native.fetch.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/auth/refresh")) refreshed = true;
      return new Response(null, { status: path.endsWith("/login") || refreshed ? 204 : 401 });
    });
    const { cookieSessionFetch } = await import("./cookie-session");
    await cookieSessionFetch("https://misty.example/v1/login", { method: "POST", body: "{}" });
    expect((await cookieSessionFetch("https://misty.example/v1/me", {})).status).toBe(204);
    expect(native.fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://misty.example/v1/login",
      "https://misty.example/v1/me",
      "https://misty.example/v1/me",
      "https://misty.example/v1/auth/refresh",
      "https://misty.example/v1/me",
    ]);
    expect(browserFetch).not.toHaveBeenCalled();
    expect(native.invoke).toHaveBeenCalledWith("auth_cookie_capture", {
      apiBase: "https://misty.example/v1",
      accountId: null,
    });
  });

  it("keeps desktop scoped credentials and anonymous requests outside the native account jar", async () => {
    native.enabled = true;
    const browserFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 401 }));
    const { cookieSessionFetch } = await import("./cookie-session");
    await cookieSessionFetch("https://misty.example/v1/spaces", {
      credentials: "omit",
      headers: { Authorization: "Bearer app-token" },
    });
    await cookieSessionFetch("https://misty.example/v1/instance", { credentials: "omit" });
    await cookieSessionFetch("https://misty.example/v1/scoped", {
      headers: { Authorization: "Bearer app-token" },
    });
    await cookieSessionFetch("https://files.example/download", {});
    expect(browserFetch).toHaveBeenCalledTimes(4);
    expect(native.fetch).not.toHaveBeenCalled();
  });

  it("shares a refresh across simultaneous expired requests without exposing tokens", async () => {
    let finish!: (response: Response) => void;
    let refreshed = false;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/auth/refresh"))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return new Response(null, { status: refreshed ? 204 : 401 });
    });
    const { cookieSessionFetch } = await import("./cookie-session");
    const first = cookieSessionFetch("https://misty.example/v1/me", {});
    const second = cookieSessionFetch("https://misty.example/v1/spaces", {});
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    refreshed = true;
    finish(new Response(null, { status: 204 }));
    expect((await Promise.all([first, second])).map((response) => response.status)).toEqual([
      204, 204,
    ]);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(
      1,
    );
    for (const [, options] of fetch.mock.calls) {
      expect(options?.credentials).toBe("include");
      expect(new Headers(options?.headers).get("X-Misty-CSRF")).toBe("1");
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    }
  });

  it("does not refresh scoped app credentials or third-party requests", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 401 }));
    const { cookieSessionFetch } = await import("./cookie-session");
    await cookieSessionFetch("https://misty.example/v1/spaces", {
      credentials: "omit",
      headers: { Authorization: "Bearer app-token" },
    });
    await cookieSessionFetch("https://files.example/download", {});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1][1]?.headers).has("X-Misty-CSRF")).toBe(false);
  });

  it("does not treat a refresh outage as a revoked session", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const { cookieSessionFetch } = await import("./cookie-session");
    await expect(cookieSessionFetch("https://misty.example/v1/me", {})).rejects.toThrow(
      "temporarily unavailable",
    );
  });

  it("does not repeat a rejected refresh until a new login establishes cookies", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async (url) => new Response(null, { status: String(url).endsWith("/login") ? 204 : 401 }),
      );
    const { cookieSessionFetch } = await import("./cookie-session");
    await cookieSessionFetch("https://misty.example/v1/me", {});
    await cookieSessionFetch("https://misty.example/v1/me/telemetry", { method: "PUT" });
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(
      1,
    );
    await cookieSessionFetch("https://misty.example/v1/login", { method: "POST" });
    await cookieSessionFetch("https://misty.example/v1/me", {});
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(
      2,
    );
  });

  it("reuses a refresh for a delayed 401 even when both complete in the same millisecond", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    let finishLate!: (response: Response) => void;
    let refreshed = false;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshed = true;
        return new Response(null, { status: 204 });
      }
      if (String(url).endsWith("/spaces") && !refreshed) {
        return new Promise<Response>((resolve) => {
          finishLate = resolve;
        });
      }
      return new Response(null, { status: refreshed ? 204 : 401 });
    });
    const { cookieSessionFetch } = await import("./cookie-session");
    const late = cookieSessionFetch("https://misty.example/v1/spaces", {});
    await vi.waitFor(() => expect(finishLate).toBeTypeOf("function"));
    await cookieSessionFetch("https://misty.example/v1/me", {});
    finishLate(new Response(null, { status: 401 }));
    expect((await late).status).toBe(204);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(
      1,
    );
  });

  it("never refreshes a late response after the account has switched", async () => {
    let generation = 0;
    const session = await import("./session");
    session.configureApiSession({
      readGeneration: () => generation,
      isTransitioning: () => false,
      readToken: async () => null,
    });
    let finish!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { cookieSessionFetch } = await import("./cookie-session");
    const pending = cookieSessionFetch("https://misty.example/v1/me", {});
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    generation++;
    finish(new Response(null, { status: 401 }));
    await expect(pending).rejects.toThrow("account changed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a mutation under a different account after refresh", async () => {
    let generation = 0;
    const session = await import("./session");
    session.configureApiSession({
      readGeneration: () => generation,
      isTransitioning: () => false,
      readToken: async () => null,
    });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        generation++;
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 401 });
    });
    const { cookieSessionFetch } = await import("./cookie-session");
    await expect(
      cookieSessionFetch("https://misty.example/v1/spaces", { method: "POST", body: "{}" }),
    ).rejects.toThrow("account changed");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rechecks cookies shared by separate tabs before rotating them again", async () => {
    let queue = Promise.resolve();
    vi.stubGlobal("navigator", {
      locks: {
        request: (_name: string, operation: () => Promise<unknown>) => {
          const next = queue.then(operation);
          queue = next.then(
            () => undefined,
            () => undefined,
          );
          return next;
        },
      },
    });
    try {
      // Separate module instances model tabs with separate refresh caches.
      const firstTab = await import("./cookie-session");
      vi.resetModules();
      const secondTab = await import("./cookie-session");
      let refreshed = false;
      let finishLate!: (response: Response) => void;
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (String(url).endsWith("/auth/refresh")) {
          refreshed = true;
          return new Response(null, { status: 204 });
        }
        if (String(url).endsWith("/spaces") && !refreshed) {
          return new Promise<Response>((resolve) => {
            finishLate = resolve;
          });
        }
        return new Response(null, { status: refreshed ? 204 : 401 });
      });
      const late = secondTab.cookieSessionFetch("https://misty.example/v1/spaces", {});
      await vi.waitFor(() => expect(finishLate).toBeTypeOf("function"));
      expect((await firstTab.cookieSessionFetch("https://misty.example/v1/me", {})).status).toBe(
        204,
      );
      finishLate(new Response(null, { status: 401 }));
      expect((await late).status).toBe(204);
      expect(
        fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh")),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not rotate valid account cookies for a resource-specific 401", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async (url) => new Response(null, { status: String(url).endsWith("/me") ? 204 : 401 }),
      );
    const { cookieSessionFetch } = await import("./cookie-session");
    expect((await cookieSessionFetch("https://misty.example/v1/resource", {})).status).toBe(401);
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/auth/refresh"))).toBe(false);
  });
});
