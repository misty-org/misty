import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const accountA = {
    id: "account-a",
    name: "Account A",
    username: "account-a",
    email: "a@example.test",
    lastUsedAt: "2026-07-20T00:00:00.000Z",
  };
  const accountB = {
    id: "account-b",
    name: "Account B",
    username: "account-b",
    email: "b@example.test",
    lastUsedAt: "2026-07-21T00:00:00.000Z",
  };
  const meA = {
    id: accountA.id,
    name: accountA.name,
    username: accountA.username,
    email: accountA.email,
    created_at: "2026-01-01T00:00:00.000Z",
    tier: "free",
    status: "active",
    allows_use: true,
  };
  const meB = { ...meA, id: accountB.id, name: accountB.name, email: accountB.email };
  const userState = { me: meA as typeof meA | null };
  const userStore = {
    get me() {
      return userState.me;
    },
    setMe: vi.fn((me: typeof meA) => {
      userState.me = me;
    }),
    clear: vi.fn(() => {
      userState.me = null;
    }),
  };
  const useUserStore = Object.assign(vi.fn(), { getState: () => userStore });
  const spacesLoad = vi.fn().mockResolvedValue(undefined);
  const useSpacesStore = Object.assign(vi.fn(), {
    getState: () => ({ load: spacesLoad }),
  });
  const mikaRefresh = vi.fn().mockResolvedValue(undefined);
  const useMikaSessionStore = Object.assign(vi.fn(), {
    getState: () => ({ refreshStatus: mikaRefresh }),
  });
  return {
    accountA,
    accountB,
    meA,
    meB,
    userState,
    userStore,
    useUserStore,
    useSpacesStore,
    useMikaSessionStore,
    spacesLoad,
    mikaRefresh,
    activeAccountId: accountA.id,
    readActiveSavedAccountSession: vi.fn(),
    activateAccountSession: vi.fn(),
    accountFetchMe: vi.fn(),
    clearAccountAuthToken: vi.fn().mockResolvedValue(null),
    updateSavedAccountSession: vi.fn(),
    setAccountSessionTransitioning: vi.fn(),
    removeSavedAccountSession: vi.fn().mockResolvedValue(true),
    saveAuthenticatedUser: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    resetSpacesAccountState: vi.fn(),
    resetMikaAccountState: vi.fn(),
    resetNotesAccountState: vi.fn(),
    resetSearchAccountState: vi.fn(),
    explorerSetState: vi.fn(),
  };
});

vi.mock("@/platform/buildTarget", () => ({ isNativeMobileBuild: false }));
vi.mock("@/stores/account/useAccountStore", () => ({
  accountFetchMe: mocks.accountFetchMe,
  accountLogout: vi.fn().mockResolvedValue(null),
  accountRevokeCurrentSession: vi.fn().mockResolvedValue(undefined),
  isAccountUnauthorizedError: () => false,
}));
vi.mock("@/stores/account/useAuthTokenStore", () => ({
  activateAccountSession: mocks.activateAccountSession,
  clearAccountAuthToken: mocks.clearAccountAuthToken,
  listSavedAccountSessions: () => [mocks.accountA, mocks.accountB],
  readActiveSavedAccountSession: mocks.readActiveSavedAccountSession,
  readAccountSessionGeneration: () => 0,
  removeSavedAccountSession: mocks.removeSavedAccountSession,
  setAccountSessionTransitioning: mocks.setAccountSessionTransitioning,
  updateSavedAccountSession: mocks.updateSavedAccountSession,
}));
vi.mock("@/stores/account/useUserStore", () => ({ useUserStore: mocks.useUserStore }));
vi.mock("@/stores/app", () => {
  const state = {
    signOut: mocks.signOut,
    saveAuthenticatedUser: mocks.saveAuthenticatedUser,
    status: { current_user: null, current_license: null },
  };
  return {
    useSetupStore: Object.assign(
      (selector: (value: Record<string, unknown>) => unknown) => selector(state),
      { getState: () => state },
    ),
  };
});
vi.mock("@/stores/explorer", () => ({
  resetSearchAccountState: mocks.resetSearchAccountState,
  useExplorerStore: { setState: mocks.explorerSetState },
}));
vi.mock("@/stores/spaces/useSpacesStore", () => ({
  resetSpacesAccountState: mocks.resetSpacesAccountState,
  useSpacesStore: mocks.useSpacesStore,
}));
vi.mock("@/stores/assistant/useMikaSessionStore", () => ({
  resetMikaAccountState: mocks.resetMikaAccountState,
  useMikaSessionStore: mocks.useMikaSessionStore,
}));
vi.mock("@/stores/notes/useNotesStore", () => ({
  resetNotesAccountState: mocks.resetNotesAccountState,
}));
vi.mock("@/analytics/lifecycle", () => ({ setAnalyticsAuthenticationState: vi.fn() }));
vi.mock("@/analytics/client", () => ({ analytics: {} }));
vi.mock("@/analytics/identity", () => ({
  TelemetryIdentityManager: class {
    sync() {}
  },
}));

import { AuthProvider, useAuth, type AuthContextValue } from "@/features/auth/AuthContext";

describe("AuthProvider account switching", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let auth: AuthContextValue | null;

  beforeAll(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
  });

  afterAll(() => vi.unstubAllGlobals());

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    localStorage.setItem("misty_user", JSON.stringify(mocks.accountA));
    mocks.activeAccountId = mocks.accountA.id;
    mocks.readActiveSavedAccountSession.mockReset().mockReturnValue(mocks.accountA);
    mocks.userState.me = mocks.meA;
    mocks.activateAccountSession.mockReset().mockImplementation(async (accountId: string) => {
      mocks.activeAccountId = accountId;
      return accountId === mocks.accountB.id ? mocks.accountB : mocks.accountA;
    });
    mocks.accountFetchMe
      .mockReset()
      .mockImplementation(async () =>
        mocks.activeAccountId === mocks.accountB.id ? mocks.meB : mocks.meA,
      );
    mocks.updateSavedAccountSession.mockReset().mockImplementation(async (account) => {
      if (account.id === mocks.accountB.id) throw new Error("keystore update failed");
    });
    mocks.clearAccountAuthToken.mockClear();
    mocks.setAccountSessionTransitioning.mockClear();
    mocks.saveAuthenticatedUser.mockClear();
    mocks.userStore.setMe.mockClear();
    mocks.userStore.clear.mockClear();
    mocks.resetSpacesAccountState.mockClear();
    mocks.resetMikaAccountState.mockClear();
    mocks.resetNotesAccountState.mockClear();
    mocks.resetSearchAccountState.mockClear();
    mocks.explorerSetState.mockClear();
    auth = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
  });

  it("restores the previous token and identity when target session persistence fails", async () => {
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    await expect(
      act(async () => {
        await auth!.switchAccount(mocks.accountB.id);
      }),
    ).rejects.toThrow("keystore update failed");

    expect(mocks.activateAccountSession.mock.calls.map(([accountId]) => accountId)).toEqual([
      mocks.accountB.id,
      mocks.accountA.id,
    ]);
    expect(mocks.saveAuthenticatedUser).not.toHaveBeenCalled();
    expect(mocks.userState.me?.id).toBe(mocks.accountA.id);
    expect(auth?.user?.id).toBe(mocks.accountA.id);
    expect(mocks.setAccountSessionTransitioning.mock.calls.map(([value]) => value)).toEqual([
      true,
      false,
    ]);
  });

  it("clears every account-scoped surface when the visible identity is removed", async () => {
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    act(() => auth!.setUser(null));

    expect(auth?.user).toBeNull();
    expect(mocks.userStore.clear).toHaveBeenCalled();
    expect(mocks.explorerSetState).toHaveBeenCalledWith({
      notifications: [],
      notificationHistory: [],
    });
    expect(mocks.resetSearchAccountState).toHaveBeenCalled();
    expect(mocks.resetSpacesAccountState).toHaveBeenCalled();
    expect(mocks.resetMikaAccountState).toHaveBeenCalled();
    expect(mocks.resetNotesAccountState).toHaveBeenCalled();
  });

  it("rehydrates the active user and profile from the server", async () => {
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    const refreshedMe = {
      ...mocks.meA,
      name: "Updated Account",
      username: "updated-account",
      avatar_version: 3,
      tier: "pro",
    };
    mocks.accountFetchMe.mockResolvedValueOnce(refreshedMe);

    await act(async () => {
      await auth!.refreshUser();
    });

    expect(mocks.userStore.setMe).toHaveBeenLastCalledWith(refreshedMe);
    expect(auth?.user).toMatchObject({
      id: mocks.accountA.id,
      name: "Updated Account",
      username: "updated-account",
      avatarVersion: 3,
      currentPlan: "pro",
    });
  });

  it("restores the active saved account before protected pages render", async () => {
    localStorage.removeItem("misty_user");

    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </MemoryRouter>,
      );
      await Promise.resolve();
    });

    expect(auth?.user?.id).toBe(mocks.accountA.id);
    expect(mocks.accountFetchMe).toHaveBeenCalled();
  });
});
