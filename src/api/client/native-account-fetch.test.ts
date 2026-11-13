import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: native.invoke,
  Channel: class {
    onmessage = () => {};
    toJSON() {
      return "__CHANNEL__:1";
    }
  },
}));
import { nativeAccountFetch } from "./native-account-fetch";

describe("native account HTTP", () => {
  beforeEach(() => {
    native.invoke.mockReset();
  });

  it("uses binary IPC and streams the response without sending cookie values to JavaScript", async () => {
    let reads = 0;
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "auth_http_start")
        return {
          status: 200,
          headers: [["Content-Type", "application/json"]],
          url: "https://misty.test/v1/me",
        };
      if (command === "auth_http_read")
        return reads++ === 0 ? Array.from(new TextEncoder().encode('{"id":"ada"}')) : null;
      return undefined;
    });
    const response = await nativeAccountFetch("https://misty.test/v1/me", {
      method: "POST",
      body: '{"name":"Ada"}',
      headers: { "Content-Type": "application/json" },
    });
    expect(await response.json()).toEqual({ id: "ada" });
    const [, body, options] = native.invoke.mock.calls.find(
      ([command]) => command === "auth_http_start",
    )!;
    expect(body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(body)).toBe('{"name":"Ada"}');
    const metadata = JSON.parse(decodeURIComponent(options.headers["X-Misty-Request"]));
    expect(
      metadata.headers.some(([name]: string[]) => ["cookie", "authorization"].includes(name)),
    ).toBe(false);
    expect(response.url).toBe("https://misty.test/v1/me");
  });

  it("aborts promptly before response headers arrive", async () => {
    native.invoke.mockImplementation((command: string) =>
      command === "auth_http_start" ? new Promise(() => {}) : Promise.resolve(),
    );
    const controller = new AbortController();
    const response = nativeAccountFetch("https://misty.test/v1/me", { signal: controller.signal });
    const rejected = expect(response).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "auth_http_start",
        expect.any(Uint8Array),
        expect.anything(),
      ),
    );
    controller.abort();
    await rejected;
    expect(native.invoke.mock.calls.some(([command]) => command === "auth_http_cancel")).toBe(true);
  });

  it("does not forward a credential-bearing POST across origins", async () => {
    native.invoke.mockResolvedValue({
      status: 307,
      headers: [["Location", "https://other.test/login"]],
      url: "https://misty.test/v1/login",
    });
    await expect(
      nativeAccountFetch("https://misty.test/v1/login", { method: "POST", body: "credentials" }),
    ).rejects.toThrow("Unsafe Misty redirect");
  });
});
