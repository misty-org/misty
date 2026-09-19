import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class {
    toJSON() {
      return "__CHANNEL__:1";
    }
  },
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => "https://misty.example/v1",
  resolveHostedApiBase: () => "https://misty.example/v1",
}));

describe("desktop account requests through the native HTTP bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    native.invoke.mockReset();
  });

  it("uses the native jar through login, a streamed /me response, and access-cookie refresh", async () => {
    const browserFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("WebView has no account cookies"));
    const pending = new Map<string, Uint8Array | null>();
    const requests: Array<{ url: string; method: string; headers: [string, string][] }> = [];
    let signedIn = false;
    let accessExpired = false;
    native.invoke.mockImplementation(async (command, body, options) => {
      if (command === "auth_http_start") {
        const head = JSON.parse(decodeURIComponent(options.headers["X-Misty-Request"]));
        requests.push(head);
        const path = new URL(head.url).pathname;
        let status = 200;
        let response: unknown = { id: "account-a", name: "Ada" };
        if (path.endsWith("/login")) {
          expect(head.method).toBe("POST");
          expect(JSON.parse(new TextDecoder().decode(body))).toEqual({
            email: "ada@example.test",
            password: "test-password",
          });
          signedIn = true;
          response = { user_id: "account-a", name: "Ada" };
        } else if (path.endsWith("/auth/refresh")) {
          status = signedIn ? 204 : 401;
          accessExpired = false;
        } else if (!signedIn || accessExpired) {
          status = 401;
          response = { error: "not authenticated" };
        }
        pending.set(head.requestId, new TextEncoder().encode(JSON.stringify(response)));
        return { status, url: head.url, headers: [["Content-Type", "application/json"]] };
      }
      if (command === "auth_http_read") {
        const chunk = pending.get(body.requestId) ?? null;
        if (chunk) pending.set(body.requestId, null);
        else pending.delete(body.requestId);
        return chunk ? Array.from(chunk) : null;
      }
      if (command === "auth_http_cancel") {
        pending.delete(body.requestId);
        return;
      }
      if (command === "auth_cookie_capture") {
        expect(signedIn).toBe(true);
        return "account-a";
      }
      throw new Error(`Unexpected native command: ${command}`);
    });
    const { cookieSessionFetch, captureAccountCookies } = await import("./cookie-session");
    const login = await cookieSessionFetch("https://misty.example/v1/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.test", password: "test-password" }),
    });
    expect(await login.json()).toMatchObject({ user_id: "account-a" });
    await captureAccountCookies("https://misty.example/v1", "account-a");
    const me = await cookieSessionFetch("https://misty.example/v1/me", {});
    expect(await me.json()).toMatchObject({ id: "account-a" });
    accessExpired = true;
    const refreshed = await cookieSessionFetch("https://misty.example/v1/me", {});
    expect(await refreshed.json()).toMatchObject({ id: "account-a" });
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/v1/login",
      "/v1/me",
      "/v1/me",
      "/v1/me",
      "/v1/auth/refresh",
      "/v1/me",
    ]);
    for (const request of requests) {
      const headers = new Headers(request.headers);
      expect(headers.get("X-Misty-CSRF")).toBe("1");
      expect(headers.has("Cookie")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
    }
    expect(browserFetch).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
  });
});
