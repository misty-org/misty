import { beforeEach, describe, expect, it, vi } from "vitest";

let keychainValue: string | null = null;

vi.mock("@impierce/tauri-plugin-keystore", () => ({
  store: vi.fn(async (value: string) => {
    keychainValue = value;
  }),
  retrieve: vi.fn(async () => keychainValue),
  remove: vi.fn(async () => {
    keychainValue = null;
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/shared/platform/buildTarget", () => ({ isNativeMobileBuild: false }));

const ada = { id: "user-ada", name: "Ada", email: "ada@example.com" };
const grace = { id: "user-grace", name: "Grace", email: "grace@example.com" };

describe("multi-account auth token storage", () => {
  beforeEach(() => {
    keychainValue = null;
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

  it("migrates the existing single Keychain token into an account vault", async () => {
    keychainValue = "legacy-token";
    localStorage.setItem("misty_user", JSON.stringify(ada));
    const store = await import("../store/useAuthTokenStore");

    await expect(store.readAccountAuthToken()).resolves.toBe("legacy-token");
    expect(store.listSavedAccountSessions()).toEqual([expect.objectContaining(ada)]);
    expect(JSON.parse(keychainValue ?? "{}")).toMatchObject({
      version: 1,
      activeAccountId: `hosted:${ada.id}`,
      sessions: [
        {
          account: expect.objectContaining(ada),
          token: "legacy-token",
          deploymentScope: "hosted",
        },
      ],
    });
  });

  it("keeps multiple sessions signed in while switching and signing out one account", async () => {
    const store = await import("../store/useAuthTokenStore");
    await store.saveAccountAuthToken("ada-token", ada);
    await store.saveAccountAuthToken("grace-token", grace);

    expect(store.listSavedAccountSessions().map((account) => account.id)).toEqual([
      grace.id,
      ada.id,
    ]);
    expect(store.readActiveSavedAccountSession()).toEqual(expect.objectContaining(grace));
    await expect(store.readAccountAuthToken()).resolves.toBe("grace-token");

    await store.activateAccountSession(ada.id);
    expect(store.readActiveSavedAccountSession()).toEqual(expect.objectContaining(ada));
    await expect(store.readAccountAuthToken()).resolves.toBe("ada-token");

    await expect(store.clearAccountAuthToken()).resolves.toEqual(expect.objectContaining(grace));
    expect(store.listSavedAccountSessions().map((account) => account.id)).toEqual([grace.id]);
    await expect(store.readAccountAuthToken()).resolves.toBe("grace-token");
  });

  it("keeps saved accounts available without presenting one as active after deactivation", async () => {
    const store = await import("../store/useAuthTokenStore");
    await store.saveAccountAuthToken("ada-token", ada);
    await store.saveAccountAuthToken("grace-token", grace);

    await store.deactivateActiveAccount();

    expect(store.listSavedAccountSessions()).toHaveLength(2);
    expect(store.readActiveSavedAccountSession()).toBeNull();
  });

  it("prunes saved-account metadata when its Keychain session no longer exists", async () => {
    const graceSession = {
      ...grace,
      lastUsedAt: "2026-07-31T00:00:00.000Z",
    };
    keychainValue = JSON.stringify({
      version: 1,
      activeAccountId: grace.id,
      sessions: [{ account: graceSession, token: "grace-token" }],
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
    await store.saveAccountAuthToken("hosted-token", ada);

    localStorage.setItem("misty:deployment-scope", "self-hosted-studio");
    vi.resetModules();
    store = await import("../store/useAuthTokenStore");
    expect(store.listSavedAccountSessions()).toEqual([]);
    await store.saveAccountAuthToken("local-token", grace);
    await expect(store.readAccountAuthToken()).resolves.toBe("local-token");

    localStorage.setItem("misty:deployment-scope", "hosted");
    vi.resetModules();
    store = await import("../store/useAuthTokenStore");
    await expect(store.readAccountAuthToken()).resolves.toBe("hosted-token");
    expect(store.listSavedAccountSessions()).toEqual([expect.objectContaining(ada)]);

    const vault = JSON.parse(keychainValue ?? "{}") as {
      sessions: Array<{ deploymentScope?: string }>;
    };
    expect(vault.sessions.map((session) => session.deploymentScope).sort()).toEqual([
      "hosted",
      "self-hosted-studio",
    ]);
  });
});
