import { beforeEach, describe, expect, it, vi } from "vitest";

let credentialFileValue: string | null = null;

vi.mock("@impierce/tauri-plugin-keystore", () => ({
  store: vi.fn(async (value: string) => {
    credentialFileValue = value;
  }),
  retrieve: vi.fn(async () => credentialFileValue),
  remove: vi.fn(async () => {
    credentialFileValue = null;
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("@/api/deployment/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveApiBase: async () => "https://misty.example/api",
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/shared/platform/buildTarget", () => ({ isNativeMobileBuild: false }));

const ada = { id: "user-ada", name: "Ada", email: "ada@example.com" };
const grace = { id: "user-grace", name: "Grace", email: "grace@example.com" };

describe("multi-account auth token storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialFileValue = null;
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => {
          values.delete(key);
        },
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    });
    localStorage.clear();
    vi.resetModules();
  });

  it("shares one secure-store read across concurrent startup requests", async () => {
    let finishRetrieve: ((value: string | null) => void) | undefined;
    const keystore = await import("@impierce/tauri-plugin-keystore");
    vi.mocked(keystore.retrieve).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRetrieve = resolve;
        }),
    );
    const store = await import("../store/useAuthTokenStore");

    const reads = [
      store.readAccountAuthToken(),
      store.readAccountAuthToken(),
      store.readAccountAuthToken(),
    ];

    expect(keystore.retrieve).toHaveBeenCalledTimes(1);
    finishRetrieve?.(null);
    await expect(Promise.all(reads)).resolves.toEqual([null, null, null]);
  });

  it("requires sign-in for legacy opaque sessions", async () => {
    credentialFileValue = "legacy-token";
    localStorage.setItem("misty_user", JSON.stringify(ada));
    const store = await import("../store/useAuthTokenStore");
    await expect(store.readAccountAuthToken()).resolves.toBeNull();
    expect(store.listSavedAccountSessions()).toEqual([]);
  });

  it("waits for native JWT cookies even after the saved account handle has loaded", async () => {
    credentialFileValue = JSON.stringify({
      version: 1,
      activeAccountId: "hosted:user-ada",
      sessions: [
        {
          account: { ...ada, lastUsedAt: "2026-09-17T00:00:00.000Z" },
          token: "cookie-session:user-ada",
          deploymentScope: "hosted",
        },
      ],
    });
    const { invoke } = await import("@tauri-apps/api/core");
    let finishRestore!: (value: boolean) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishRestore = resolve;
        }),
    );
    const store = await import("../store/useAuthTokenStore");
    const first = store.readAccountAuthToken();
    await vi.waitFor(() => expect(finishRestore).toBeTypeOf("function"));
    let secondFinished = false;
    const second = store.readAccountAuthToken().then((value) => {
      secondFinished = true;
      return value;
    });
    await Promise.resolve();
    expect(secondFinished).toBe(false);
    finishRestore(true);
    await expect(Promise.all([first, second])).resolves.toEqual([
      "cookie-session:user-ada",
      "cookie-session:user-ada",
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not cache an authenticated handle when its native cookies cannot be restored", async () => {
    credentialFileValue = JSON.stringify({
      version: 1,
      activeAccountId: "hosted:user-ada",
      sessions: [
        {
          account: { ...ada, lastUsedAt: "2026-09-17T00:00:00.000Z" },
          token: "cookie-session:user-ada",
          deploymentScope: "hosted",
        },
      ],
    });
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(false);
    const store = await import("../store/useAuthTokenStore");
    await expect(store.readAccountAuthToken()).resolves.toBeNull();
    await expect(store.readAccountAuthToken()).resolves.toBeNull();
  });

  it("keeps multiple sessions signed in while switching and signing out one account", async () => {
    const store = await import("../store/useAuthTokenStore");
    await store.saveAccountAuthToken("cookie-session:user-ada", ada);
    await store.saveAccountAuthToken("cookie-session:user-grace", grace);

    expect(store.listSavedAccountSessions().map((account) => account.id)).toEqual([
      grace.id,
      ada.id,
    ]);
    expect(store.readActiveSavedAccountSession()).toEqual(expect.objectContaining(grace));
    await expect(store.readAccountAuthToken()).resolves.toBe("cookie-session:user-grace");

    await store.activateAccountSession(ada.id);
    expect(store.readActiveSavedAccountSession()).toEqual(expect.objectContaining(ada));
    await expect(store.readAccountAuthToken()).resolves.toBe("cookie-session:user-ada");

    await expect(store.clearAccountAuthToken()).resolves.toEqual(expect.objectContaining(grace));
    expect(store.listSavedAccountSessions().map((account) => account.id)).toEqual([grace.id]);
    await expect(store.readAccountAuthToken()).resolves.toBe("cookie-session:user-grace");
  });

  it("keeps saved accounts available without presenting one as active after deactivation", async () => {
    const store = await import("../store/useAuthTokenStore");
    await store.saveAccountAuthToken("cookie-session:user-ada", ada);
    await store.saveAccountAuthToken("cookie-session:user-grace", grace);

    await store.deactivateActiveAccount();

    expect(store.listSavedAccountSessions()).toHaveLength(2);
    expect(store.readActiveSavedAccountSession()).toBeNull();
  });

  it("keeps the previous account active when the target cookie record is missing", async () => {
    const store = await import("../store/useAuthTokenStore");
    await store.saveAccountAuthToken("cookie-session:user-ada", ada);
    await store.saveAccountAuthToken("cookie-session:user-grace", grace);
    await store.activateAccountSession(ada.id);
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(false);
    await expect(store.activateAccountSession(grace.id)).rejects.toThrow("Sign in again");
    expect(store.readActiveSavedAccountSession()).toEqual(expect.objectContaining(ada));
    await expect(store.readAccountAuthToken()).resolves.toBe("cookie-session:user-ada");
  });

  it("prunes saved-account metadata when its credential file session no longer exists", async () => {
    const graceSession = {
      ...grace,
      lastUsedAt: "2026-07-31T00:00:00.000Z",
    };
    credentialFileValue = JSON.stringify({
      version: 1,
      activeAccountId: grace.id,
      sessions: [{ account: graceSession, token: "cookie-session:user-grace" }],
    });
    localStorage.setItem(
      "misty:account-sessions",
      JSON.stringify([{ ...ada, lastUsedAt: "2026-07-30T00:00:00.000Z" }, graceSession]),
    );
    localStorage.setItem("misty:active-account-id", ada.id);
    const store = await import("../store/useAuthTokenStore");

    await expect(store.activateAccountSession(ada.id)).rejects.toThrow(
      "That saved Misty session is no longer available.",
    );
    expect(store.listSavedAccountSessions()).toEqual([graceSession]);
    expect(store.readActiveSavedAccountSession()).toEqual(graceSession);
  });

  it("keeps Hosted and self-hosted credentials in separate deployment namespaces", async () => {
    let store = await import("../store/useAuthTokenStore");
    await store.saveAccountAuthToken("cookie-session:user-ada", ada);

    localStorage.setItem("misty:deployment-scope", "self-hosted-studio");
    vi.resetModules();
    store = await import("../store/useAuthTokenStore");
    expect(store.listSavedAccountSessions()).toEqual([]);
    await store.saveAccountAuthToken("cookie-session:user-grace", grace);
    await expect(store.readAccountAuthToken()).resolves.toBe("cookie-session:user-grace");

    localStorage.setItem("misty:deployment-scope", "hosted");
    vi.resetModules();
    store = await import("../store/useAuthTokenStore");
    await expect(store.readAccountAuthToken()).resolves.toBe("cookie-session:user-ada");
    expect(store.listSavedAccountSessions()).toEqual([expect.objectContaining(ada)]);

    const vault = JSON.parse(credentialFileValue ?? "{}") as {
      sessions: Array<{ deploymentScope?: string }>;
    };
    expect(vault.sessions.map((session) => session.deploymentScope).sort()).toEqual([
      "hosted",
      "self-hosted-studio",
    ]);
  });
});
