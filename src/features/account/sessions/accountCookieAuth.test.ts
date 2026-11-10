import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveAccountAuthToken: vi.fn(),
  notifyApiSessionInvalid: vi.fn(),
  invoke: vi.fn<(command: string, args?: unknown) => Promise<string>>(async () => "account-a"),
  nativeFetch: vi.fn<typeof fetch>(),
}));
vi.mock("@/api/client/native-account-fetch", () => ({ nativeAccountFetch: mocks.nativeFetch }));
vi.mock("./useAuthTokenStore", () => ({ saveAccountAuthToken: mocks.saveAccountAuthToken }));
vi.mock("@/api/client/session", () => ({
  readApiAuthToken: async () => null,
  readApiSessionGeneration: () => 0,
  notifyApiSessionInvalid: mocks.notifyApiSessionInvalid,
  isApiSignedOut: () => false,
}));
vi.mock("@/api/deployment/api", () => ({
  resolveApiBase: async () => "https://misty.example/v1",
  resolveHostedApiBase: () => "https://misty.example/v1",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

describe("server JWT cookie account contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.nativeFetch.mockReset();
  });

  it("signs in with metadata-only JSON, captures HttpOnly cookies, and uses them for /me", async () => {
    const user = { user_id: "account-a", name: "Ada", username: "ada", email: "ada@example.test" };
    const browserFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Account request bypassed native cookies"));
    const fetch = mocks.nativeFetch.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(String(url).endsWith("/login") ? user : { ...user, id: user.user_id }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const account = await import("./useAccountStore");
    await expect(account.accountSignIn(user.email, "password")).resolves.toMatchObject({
      id: "account-a",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("auth_session_capture", {
      apiBase: "https://misty.example/v1",
      accountId: "account-a",
    });
    expect(mocks.saveAccountAuthToken).toHaveBeenCalledWith(
      "cookie-session:account-a",
      expect.objectContaining({ id: "account-a" }),
    );
    await expect(account.accountFetchMe()).resolves.toMatchObject({ id: "account-a" });
    expect(browserFetch).not.toHaveBeenCalled();
    for (const [, options] of fetch.mock.calls) {
      expect(options?.credentials).toBe("include");
      expect(new Headers(options?.headers).get("X-Misty-CSRF")).toBe("1");
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    }
  });

  it("redeems a setup key and remembers its reset token", async () => {
    mocks.nativeFetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            user_id: "account-c",
            username: "cara",
            email: "cara@example.test",
            password_reset_token: "reset-token",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const account = await import("./useAccountStore");
    const { passwordResetToken } = await import("./passwordReset");
    await account.accountRedeemSetupKey(" misty_setup_abcdefghijklmnopqrstuvwxyz234567 ");
    expect(passwordResetToken("account-c")).toBe("reset-token");
    const calls = mocks.nativeFetch.mock.calls;
    const [url, options] = calls[calls.length - 1]!;
    expect(String(url)).toBe("https://misty.example/v1/setup-keys/redeem");
    expect(JSON.parse(String(options?.body))).toEqual({
      setup_key: "misty_setup_abcdefghijklmnopqrstuvwxyz234567",
    });
  });

  it("invalidates the restored identity when the server rejects its access and refresh cookies", async () => {
    mocks.nativeFetch.mockImplementation(
      async () => new Response("not authenticated", { status: 401 }),
    );
    const account = await import("./useAccountStore");
    await expect(account.accountFetchMe()).rejects.toMatchObject({ status: 401 });
    expect(mocks.notifyApiSessionInvalid).toHaveBeenCalledOnce();
  });

  it("does not invalidate a saved account for an incorrect sign-in password", async () => {
    mocks.nativeFetch.mockImplementation(
      async () => new Response("invalid credentials", { status: 401 }),
    );
    const account = await import("./useAccountStore");
    await expect(account.accountSignIn("ada@example.test", "wrong")).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.notifyApiSessionInvalid).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith("auth_session_capture", expect.anything());
  });

  it("sends the password as typed, once", async () => {
    const user = { user_id: "account-a", username: "ada", email: "ada@example.test" };
    const logins = () =>
      mocks.nativeFetch.mock.calls
        .filter(([url]) => String(url).endsWith("/login"))
        .map(([, options]) => JSON.parse(String(options?.body)).password);
    mocks.nativeFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const account = await import("./useAccountStore");
    await account.accountSignIn(user.email, "typed password");
    expect(logins()).toEqual(["typed password"]);

    mocks.nativeFetch.mockClear();
    mocks.nativeFetch.mockImplementation(
      async () => new Response("invalid credentials", { status: 401 }),
    );
    await expect(account.accountSignIn(user.email, "typo")).rejects.toMatchObject({ status: 401 });
    expect(logins()).toEqual(["typo"]);
  });
});
