import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
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
  const agentRefresh = vi.fn().mockResolvedValue(undefined);
  const useAgentSessionStore = Object.assign(vi.fn(), {
    getState: () => ({ refreshStatus: agentRefresh }),
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
    useAgentSessionStore,
    spacesLoad,
    agentRefresh,
    activeAccountId: accountA.id,
    generation: 0,
    readActiveSavedAccountSession: vi.fn(),
    activateAccountSession: vi.fn(),
    accountFetchMe: vi.fn(),
    accountLogout: vi.fn().mockResolvedValue(undefined),
    clearAccountAuthToken: vi.fn().mockResolvedValue(null),
    deactivateActiveAccount: vi.fn().mockResolvedValue(undefined),
    updateSavedAccountSession: vi.fn(),
    setAccountSessionTransitioning: vi.fn(),
    removeSavedAccountSession: vi.fn().mockResolvedValue(true),
    saveAuthenticatedUser: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    resetSpacesAccountState: vi.fn(),
    resetAgentAccountState: vi.fn(),
    resetNotesAccountState: vi.fn(),
    resetSearchAccountState: vi.fn(),
    explorerSetState: vi.fn(),
  };
});

vi.mock("@/shared/platform/buildTarget", () => ({ isNativeMobileBuild: false }));
vi.mock("./store/useAccountStore", () => ({
  accountFetchMe: mocks.accountFetchMe,
  accountLogout: mocks.accountLogout,
  isAccountUnauthorizedError: (error: { status?: number }) => error?.status === 401,
}));
vi.mock("./store/useAuthTokenStore", () => ({
  activateAccountSession: mocks.activateAccountSession,
  clearAccountAuthToken: mocks.clearAccountAuthToken,
  deactivateActiveAccount: mocks.deactivateActiveAccount,
  listSavedAccountSessions: () => [mocks.accountA, mocks.accountB],
  readActiveSavedAccountSession: mocks.readActiveSavedAccountSession,
  readAccountSessionGeneration: () => mocks.generation,
  removeSavedAccountSession: mocks.removeSavedAccountSession,
  setAccountSessionTransitioning: mocks.setAccountSessionTransitioning,
  updateSavedAccountSession: mocks.updateSavedAccountSession,
}));
vi.mock("./store/useUserStore", () => ({ useUserStore: mocks.useUserStore }));
vi.mock("@/features/installer", () => {
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
vi.mock("@/features/app-shell", () => {
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
    useAppRouteMemoryStore: Object.assign(vi.fn(), {
      getState: () => ({ resetAppRoute: vi.fn(), lastAppRoute: "/home" }),
    }),
  };
});
vi.mock("@/features/files/workspace/explorer", () => ({
  useExplorerStore: { setState: mocks.explorerSetState },
}));
vi.mock("@/features/files/workspace/search", () => ({
  resetSearchAccountState: mocks.resetSearchAccountState,
}));
vi.mock("@/features/spaces", () => ({
  resetSpacesAccountState: mocks.resetSpacesAccountState,
  useSpacesStore: mocks.useSpacesStore,
}));
vi.mock("@/features/agents/store/useAgentSessionStore", () => ({
  resetAgentAccountState: mocks.resetAgentAccountState,
  useAgentSessionStore: mocks.useAgentSessionStore,
}));
vi.mock("@/features/agents", () => ({
  resetAllAgentAccountState: () => {
    mocks.resetAgentAccountState();
  },
  refreshAllAgentAccountState: () => {
    void mocks.agentRefresh();
  },
}));
vi.mock("@/features/journal/notes", () => ({
  resetNotesAccountState: mocks.resetNotesAccountState,
}));
vi.mock("@/telemetry/lifecycle", () => ({ setAnalyticsAuthenticationState: vi.fn() }));
vi.mock("@/telemetry/client", () => ({ analytics: {} }));
vi.mock("@/telemetry/identity", () => ({
  TelemetryIdentityManager: class {
    sync() {}
  },
}));

import { AuthProvider, useAuth, type AuthContextValue } from "./AuthContext";
import SignIn from "./SignInPage";

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
    mocks.generation = 0;
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
    mocks.deactivateActiveAccount.mockClear();
    mocks.signOut.mockClear();
    mocks.setAccountSessionTransitioning.mockClear();
    mocks.saveAuthenticatedUser.mockClear();
    mocks.userStore.setMe.mockClear();
    mocks.userStore.clear.mockClear();
    mocks.resetSpacesAccountState.mockClear();
    mocks.resetAgentAccountState.mockClear();
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

  it("preserves the original sign-in error when the previous saved session is stale", async () => {
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

    mocks.activateAccountSession.mockRejectedValueOnce(
      new Error("That saved Misty session is no longer available."),
    );

    let signInError: unknown;
    await act(async () => {
      try {
        await auth!.authenticateAccount(async () => {
          throw new Error("Invalid email or password.");
        });
      } catch (error) {
        signInError = error;
      }
    });

    expect(signInError).toEqual(new Error("Invalid email or password."));
    expect(mocks.userStore.clear).toHaveBeenCalled();
    expect(auth?.user).toBeNull();
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

    await act(async () => {
      await auth!.setUser(null);
    });

    expect(auth?.user).toBeNull();
    expect(mocks.userStore.clear).toHaveBeenCalled();
    expect(mocks.resetSpacesAccountState).toHaveBeenCalled();
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

  it("clears an expired legacy identity during StrictMode startup and releases the transition", async () => {
    mocks.accountFetchMe.mockRejectedValue(
      Object.assign(new Error("not authenticated"), { status: 401 }),
    );
    function Probe() {
      auth = useAuth();
      return null;
    }
    await act(async () => {
      root!.render(
        <StrictMode>
          <MemoryRouter>
            <AuthProvider>
              <Probe />
            </AuthProvider>
          </MemoryRouter>
        </StrictMode>,
      );
    });
    expect(mocks.deactivateActiveAccount).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(auth?.user).toBeNull();
    expect(auth?.transitioning).toBe(false);
    expect(mocks.setAccountSessionTransitioning).toHaveBeenLastCalledWith(false);
  });

  it("releases the transition after an expired-cookie event changes the visible account", async () => {
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
    });
    mocks.accountFetchMe.mockRejectedValue(Object.assign(new Error("expired"), { status: 401 }));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("misty:account-session-invalid"));
    });
    expect(mocks.deactivateActiveAccount).toHaveBeenCalledOnce();
    expect(auth?.user).toBeNull();
    expect(auth?.transitioning).toBe(false);
    expect(mocks.setAccountSessionTransitioning).toHaveBeenLastCalledWith(false);
  });

  it.each(["valid", "offline", "account changed"])(
    "keeps the account active after a stale 401 when validation is %s",
    async (outcome) => {
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
      });
      let resolve!: (value: typeof mocks.meA) => void;
      let reject!: (error: Error) => void;
      mocks.accountFetchMe.mockReset().mockImplementation(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      await act(async () => {
        for (let i = 0; i < 3; i++)
          window.dispatchEvent(new CustomEvent("misty:account-session-invalid"));
      });
      expect(mocks.accountFetchMe).toHaveBeenCalledOnce();
      expect(auth?.transitioning).toBe(false);
      await act(async () => {
        if (outcome === "valid") resolve(mocks.meA);
        else {
          if (outcome === "account changed") mocks.generation++;
          reject(Object.assign(new Error(outcome), { status: outcome === "offline" ? 503 : 401 }));
        }
      });
      expect(mocks.deactivateActiveAccount).not.toHaveBeenCalled();
      expect(mocks.signOut).not.toHaveBeenCalled();
      expect(auth?.user?.id).toBe(mocks.accountA.id);
    },
  );

  it.each(["switch", "authenticate", "resume", "logout"])(
    "releases the account transition when %s preparation throws",
    async (operation) => {
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
      });
      mocks.resetSpacesAccountState.mockImplementationOnce(() => {
        throw new Error("Account state reset failed");
      });
      await act(async () => {
        const attempt =
          operation === "switch"
            ? auth!.switchAccount(mocks.accountB.id)
            : operation === "authenticate"
              ? auth!.authenticateAccount(async () => mocks.accountB)
              : operation === "resume"
                ? auth!.resumeAccount(mocks.accountA.id)
                : auth!.logout();
        await expect(attempt).rejects.toThrow("Account state reset failed");
      });
      expect(auth?.transitioning).toBe(false);
      expect(mocks.setAccountSessionTransitioning).toHaveBeenLastCalledWith(false);
      await act(async () => {
        await auth!.resumeAccount(mocks.accountA.id);
      });
      expect(auth?.user?.id).toBe(mocks.accountA.id);
    },
  );

  it("rejects a second resume while restoration is pending instead of reporting success", async () => {
    localStorage.clear();
    mocks.readActiveSavedAccountSession.mockReturnValue(null);
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
    });
    let release!: (account: typeof mocks.accountA) => void;
    mocks.activateAccountSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(async () => {
      pending = auth!.resumeAccount(mocks.accountA.id);
    });
    await expect(auth!.resumeAccount(mocks.accountB.id)).rejects.toThrow("already in progress");
    expect(mocks.activateAccountSession).toHaveBeenCalledOnce();
    await act(async () => {
      release(mocks.accountA);
      await pending;
    });
    expect(auth?.user?.id).toBe(mocks.accountA.id);
    expect(auth?.transitioning).toBe(false);
  });

  it("resumes a saved account from the chooser through identity remount and protected navigation", async () => {
    localStorage.clear();
    mocks.readActiveSavedAccountSession.mockReturnValue(null);
    function AccountOutlet() {
      auth = useAuth();
      return <Outlet key={auth.user?.id ?? "anonymous"} />;
    }
    function Workspace() {
      const current = useAuth();
      return current.user ? (
        <div>Workspace for {current.user.id}</div>
      ) : (
        <Navigate to="/signin" replace />
      );
    }
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={["/signin"]}>
          <AuthProvider>
            <Routes>
              <Route element={<AccountOutlet />}>
                <Route path="/signin" element={<SignIn />} />
                <Route path="/browser" element={<Workspace />} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>,
      );
    });
    const accountButton = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(mocks.accountA.email),
      )!;
    mocks.resetSpacesAccountState.mockImplementationOnce(() => {
      throw new Error("Account state reset failed");
    });
    await act(async () => {
      accountButton().click();
    });
    expect(container.textContent).toContain(
      "Could not resume this account. Account state reset failed",
    );
    expect(container.textContent).toContain("Choose an account");
    expect(auth?.transitioning).toBe(false);
    let release!: (account: typeof mocks.accountA) => void;
    mocks.activateAccountSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await act(async () => {
      accountButton().click();
    });
    expect(container.textContent).toContain("Signing in…");
    expect(accountButton().disabled).toBe(true);
    await act(async () => {
      release(mocks.accountA);
    });
    expect(container.textContent).toBe("Workspace for account-a");
    expect(auth?.transitioning).toBe(false);
    expect(mocks.saveAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: mocks.accountA.id }),
      expect.anything(),
    );
  });

  it("swaps verified account identity without reloading retired Spaces", async () => {
    mocks.updateSavedAccountSession.mockReset().mockResolvedValue(undefined);

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

    await act(async () => {
      await auth!.switchAccount(mocks.accountB.id);
    });

    expect(auth?.user?.id).toBe(mocks.accountB.id);
    expect(mocks.userState.me?.id).toBe(mocks.accountB.id);
    expect(mocks.saveAuthenticatedUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: mocks.accountB.id }),
      expect.anything(),
    );
    expect(mocks.spacesLoad).not.toHaveBeenCalled();
  });

  it("keeps a switch target whose session expired and restores the previous account", async () => {
    mocks.updateSavedAccountSession.mockReset().mockResolvedValue(undefined);
    mocks.accountFetchMe.mockReset().mockImplementation(async () => {
      if (mocks.activeAccountId === mocks.accountB.id) throw { status: 401 };
      return mocks.meA;
    });

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
    ).rejects.toMatchObject({ name: "SavedAccountSessionUnavailableError" });

    expect(mocks.clearAccountAuthToken).not.toHaveBeenCalled();
    expect(auth?.user?.id).toBe(mocks.accountA.id);
    expect(auth?.accounts.map((account) => account.id)).toContain(mocks.accountB.id);
  });

  it("finishes signing out even when a cleanup step fails", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("native sign-out failed"));

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

    await act(async () => {
      await auth!.logout();
    });

    expect(mocks.accountLogout).toHaveBeenCalledWith(mocks.accountA.id);
    expect(mocks.deactivateActiveAccount).toHaveBeenCalled();
    expect(mocks.activateAccountSession).not.toHaveBeenCalled();
    expect(auth?.user).toBeNull();
    expect(auth?.transitioning).toBe(false);
  });
});
