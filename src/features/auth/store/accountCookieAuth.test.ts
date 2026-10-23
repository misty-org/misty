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
vi.mock("@/telemetry/client", () => ({ analytics: { isAnalyticsEnabled: () => false } }));
vi.mock("@/telemetry/lifecycle", () => ({ configureTelemetryPreferencesSync: vi.fn() }));

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
    expect(mocks.invoke).toHaveBeenCalledWith("auth_cookie_capture", {
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
    expect(mocks.invoke).not.toHaveBeenCalledWith("auth_cookie_capture", expect.anything());
  });

  describe("derived login credential", () => {
    const user = { user_id: "account-a", username: "ada", email: "ada@example.test" };
    const json = { status: 200, headers: { "Content-Type": "application/json" } };
    const loginBodies = () =>
      mocks.nativeFetch.mock.calls
        .filter(([url]) => String(url).endsWith("/login"))
        .map(([, options]) => JSON.parse(String(options?.body)).password);
    beforeEach(() => {
      localStorage.clear();
      mocks.invoke.mockImplementation(async (command: string) =>
        command === "account_login_credential" ? "derived-credential" : "account-a",
      );
    });

    it("sends the credential derived on the device, not the password, and remembers the account", async () => {
      mocks.nativeFetch.mockImplementation(
        async () => new Response(JSON.stringify(user), json),
      );
      const account = await import("./useAccountStore");
      const { isCredentialAccount } = await import("./accountCredential");
      await account.accountSignIn(user.email, "typed password");
      expect(loginBodies()).toEqual(["derived-credential"]);
      expect(isCredentialAccount("account-a")).toBe(true);
    });

    const refuseCredential = () =>
      mocks.nativeFetch.mockImplementation(async (_url, options) =>
        JSON.parse(String(options?.body)).password === "derived-credential"
          ? new Response("invalid credentials", { status: 401 })
          : new Response(JSON.stringify(user), json),
      );

    it("falls back to the password as typed for an account this device has not seen use a credential", async () => {
      refuseCredential();
      const account = await import("./useAccountStore");
      await account.accountSignIn(user.email, "typed password");
      expect(loginBodies()).toEqual(["derived-credential", "typed password"]);
    });

    it("never sends the password in plain form for an account known to use a credential", async () => {
      const { markCredentialAccount, isCredentialAccount } = await import("./accountCredential");
      markCredentialAccount("account-a", " Ada@Example.test ");
      refuseCredential();
      const account = await import("./useAccountStore");
      // A typo, or a server that answers 401 to the credential, learns nothing more.
      await expect(account.accountSignIn(user.email, "typo")).rejects.toBeInstanceOf(
        account.CredentialSignInRefused,
      );
      expect(loginBodies()).toEqual(["derived-credential"]);
      expect(isCredentialAccount("account-a")).toBe(true);
    });

    it("sends it as typed only when asked, and then forgets the account is safe", async () => {
      const { markCredentialAccount, isCredentialAccount } = await import("./accountCredential");
      markCredentialAccount("account-a", user.email);
      refuseCredential();
      const account = await import("./useAccountStore");
      await account.accountSignIn(user.email, "reset password", { legacy: true });
      expect(loginBodies()).toEqual(["reset password"]);
      // The server has now seen this password in plain form, so it must not seed keys.
      expect(isCredentialAccount("account-a")).toBe(false);
    });

    it("does not retry on a server error", async () => {
      mocks.nativeFetch.mockImplementation(async () => new Response("down", { status: 500 }));
      const account = await import("./useAccountStore");
      await expect(account.accountSignIn(user.email, "typed password")).rejects.toBeTruthy();
      expect(loginBodies()).toEqual(["derived-credential"]);
    });
  });
});
