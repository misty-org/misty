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
vi.mock("../../../shared/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("../../../platform/buildTarget", () => ({ isNativeMobileBuild: false }));

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
    const store = await import("./authTokenStore");

    await expect(store.readAccountAuthToken()).resolves.toBe("legacy-token");
    expect(store.listSavedAccountSessions()).toEqual([expect.objectContaining(ada)]);
    expect(JSON.parse(keychainValue ?? "{}")).toMatchObject({
      version: 1,
      activeAccountId: ada.id,
      sessions: [{ account: expect.objectContaining(ada), token: "legacy-token" }],
    });
  });

  it("keeps multiple sessions signed in while switching and signing out one account", async () => {
    const store = await import("./authTokenStore");
    await store.saveAccountAuthToken("ada-token", ada);
    await store.saveAccountAuthToken("grace-token", grace);

    expect(store.listSavedAccountSessions().map((account) => account.id)).toEqual([
      grace.id,
      ada.id,
    ]);
    await expect(store.readAccountAuthToken()).resolves.toBe("grace-token");

    await store.activateAccountSession(ada.id);
    await expect(store.readAccountAuthToken()).resolves.toBe("ada-token");

    await expect(store.clearAccountAuthToken()).resolves.toEqual(expect.objectContaining(grace));
    expect(store.listSavedAccountSessions().map((account) => account.id)).toEqual([grace.id]);
    await expect(store.readAccountAuthToken()).resolves.toBe("grace-token");
  });
});
