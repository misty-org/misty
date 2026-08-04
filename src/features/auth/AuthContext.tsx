import type { AuthUser, AuthContextValue } from "@/models/interfaces/features/auth/AuthContext";
export type { AuthUser, AuthContextValue } from "@/models/interfaces/features/auth/AuthContext";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { accountFetchMe, isAccountUnauthorizedError } from "@/stores/account/useAccountStore";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";
import {
  activateAccountSession,
  clearAccountAuthToken,
  deactivateActiveAccount,
  listSavedAccountSessions,
  readActiveSavedAccountSession,
  readAccountSessionGeneration,
  removeSavedAccountSession,
  setAccountSessionTransitioning,
  updateSavedAccountSession,
} from "@/stores/account/useAuthTokenStore";
import type { SavedAccountSession } from "@/models/interfaces/stores/account/useAuthTokenStore";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import type { CurrentLicense } from "@/models/types/features/installer/types";
import {
  resetAllAgentAccountState,
  refreshAllAgentAccountState,
} from "@/stores/agent/agentAccountLifecycle";
import { resetSpacesAccountState, useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { removeSpaceReferenceCache } from "@/stores/spaces/spaceReferenceCache";
import { resetNotesAccountState } from "@/stores/notes/useNotesStore";
import { useSetupStore } from "@/stores/app";
import { useAppRouteMemoryStore } from "@/stores/app/useAppRouteMemoryStore";
import { resetSearchAccountState, useExplorerStore } from "@/stores/explorer";
import { useUserStore } from "@/stores/account/useUserStore";
import { setAnalyticsAuthenticationState } from "@/analytics/lifecycle";
import { TelemetryIdentityManager } from "@/analytics/identity";
import { analytics } from "@/analytics/client";
import { restoreSavedSession, tryRestoreSavedSession } from "./sessionRecovery";

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => {},
  accounts: [],
  transitioning: false,
  refreshUser: async () => null,
  authenticateAccount: async (request) => request(),
  switchAccount: async () => {},
  resumeAccount: async () => {},
  removeAccount: async () => {},
  logout: async () => {},
});

const shouldPersistAuthUser = !isNativeMobileBuild;
const authUserStorageKey = "misty_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const signOut = useSetupStore((state) => state.signOut);
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);
  const nativeUser = useSetupStore((state) => state.status?.current_user ?? null);
  const navigate = useNavigate();
  const [user, setUserState] = useState<AuthUser | null>(() => readInitialUser());
  const [accounts, setAccounts] = useState<SavedAccountSession[]>(() => listSavedAccountSessions());
  const [transitioning, setTransitioning] = useState(false);
  const [telemetryIdentity] = useState(() => new TelemetryIdentityManager(analytics));
  const startupValidationStarted = useRef(false);
  const accountOperationActive = useRef(false);
  const activeUser = user ?? nativeUser;

  const beginAccountOperation = useCallback(() => {
    if (accountOperationActive.current) {
      throw new Error("Another account change is already in progress.");
    }
    accountOperationActive.current = true;
    setTransitioning(true);
    setAccountSessionTransitioning(true);
  }, []);

  const finishAccountOperation = useCallback(() => {
    accountOperationActive.current = false;
    setAccountSessionTransitioning(false);
    setTransitioning(false);
  }, []);

  // Signs out the active account and returns to the sign-in chooser without
  // silently jumping to another saved account. Every account stays listed.
  const deactivateToChooser = useCallback(async () => {
    await deactivateActiveAccount();
    await signOut();
    useAppRouteMemoryStore.getState().resetAppRoute();
    useUserStore.getState().clear();
    setUserState(null);
    setAccounts(listSavedAccountSessions());
    navigate("/signin", { replace: true });
  }, [navigate, signOut]);

  const setUser = useCallback(
    (nextUser: AuthUser | null) => {
      if ((activeUser?.id ?? null) !== (nextUser?.id ?? null)) resetAccountScopedState();
      setUserState(nextUser);
      setAccounts(listSavedAccountSessions());
    },
    [activeUser?.id],
  );

  const switchAccount = useCallback(
    async (accountId: string) => {
      if (accountId === activeUser?.id) return;
      const previousUser = activeUser;
      const previousAccountId = previousUser?.id ?? "";
      const previousMe = useUserStore.getState().me;
      let accountReady = false;
      beginAccountOperation();
      resetAccountScopedState();
      try {
        const saved = await activateAccountSession(accountId);
        const me = await accountFetchMe();
        assertAccountIdentity(me, saved.id);
        const nextUser = authUserFromMe(me, saved);
        // Complete fallible session persistence before committing the visible
        // and native identity. A failed write can then safely reactivate the
        // previous token without leaving the two account identities crossed.
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser, licenseFromMe(me));
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        accountReady = true;
      } catch (error) {
        if (isInvalidAccountSessionError(error)) await clearAccountAuthToken();
        const restoredPreviousAccount = await tryRestoreSavedSession(previousAccountId);
        if (restoredPreviousAccount) {
          if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
          if (previousUser?.id === previousAccountId) setUserState(previousUser);
          accountReady = true;
        } else {
          useUserStore.getState().clear();
          setUserState(null);
        }
        setAccounts(listSavedAccountSessions());
        throw error;
      } finally {
        finishAccountOperation();
        if (accountReady) refreshAuthenticatedAccountState();
      }
    },
    [activeUser, beginAccountOperation, finishAccountOperation, saveAuthenticatedUser],
  );

  const authenticateAccount = useCallback(
    async (request: () => Promise<AuthUser>) => {
      const previousUser = activeUser;
      const previousAccountId = previousUser?.id ?? "";
      const previousMe = useUserStore.getState().me;
      const previousLicense = useSetupStore.getState().status?.current_license ?? null;
      let authenticated: AuthUser | null = null;
      let accountReady = false;
      beginAccountOperation();
      resetAccountScopedState();
      try {
        authenticated = await request();
        const me = await accountFetchMe();
        assertAccountIdentity(me, authenticated.id);
        const nextUser = authUserFromMe(me, {
          ...authenticated,
          lastUsedAt: new Date().toISOString(),
        });
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser, licenseFromMe(me));
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        accountReady = true;
        return nextUser;
      } catch (error) {
        // A 401 from /me after login means the newly stored token is invalid.
        // A 401 from the login request itself must leave the current account
        // untouched, so only clear after the request produced an identity.
        if (authenticated && isInvalidAccountSessionError(error)) {
          await clearAccountAuthToken();
        }
        let restoredPreviousAccount = false;
        if (await tryRestoreSavedSession(previousAccountId)) {
          try {
            if (previousUser && previousLicense) {
              await saveAuthenticatedUser(previousUser, previousLicense);
            }
            if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
            if (previousUser?.id === previousAccountId) setUserState(previousUser);
            restoredPreviousAccount = true;
            accountReady = true;
          } catch {
            // Restoring the previous native identity is best-effort. Preserve
            // the original sign-in error instead of replacing it with a
            // secondary rollback failure.
          }
        }
        if (!restoredPreviousAccount) {
          useUserStore.getState().clear();
          setUserState(null);
        }
        setAccounts(listSavedAccountSessions());
        throw error;
      } finally {
        finishAccountOperation();
        if (accountReady) refreshAuthenticatedAccountState();
      }
    },
    [activeUser, beginAccountOperation, finishAccountOperation, saveAuthenticatedUser],
  );

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    if (!activeUser || accountOperationActive.current) return activeUser ?? null;

    const expectedAccountId = activeUser.id;
    const generation = readAccountSessionGeneration();
    const me = await accountFetchMe();
    if (readAccountSessionGeneration() !== generation) return null;
    assertAccountIdentity(me, expectedAccountId);

    const fallback = listSavedAccountSessions().find(
      (account) => account.id === expectedAccountId,
    ) ?? {
      ...activeUser,
      lastUsedAt: new Date().toISOString(),
    };
    const nextUser = authUserFromMe(me, fallback);
    useUserStore.getState().setMe(me);
    setUserState(nextUser);
    return nextUser;
  }, [activeUser]);

  useEffect(() => {
    setAnalyticsAuthenticationState(Boolean(activeUser));
    telemetryIdentity.sync(activeUser);
  }, [activeUser, telemetryIdentity]);

  useEffect(() => {
    if (shouldPersistAuthUser) {
      writeStoredUser(activeUser);
    } else {
      clearStoredUser();
    }
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser) {
      setAccounts(listSavedAccountSessions());
      return;
    }
    void updateSavedAccountSession(activeUser)
      .then(() => setAccounts(listSavedAccountSessions()))
      .catch(() => undefined);
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser || startupValidationStarted.current) return;
    startupValidationStarted.current = true;
    let canceled = false;
    const validationGeneration = readAccountSessionGeneration();
    void (async () => {
      try {
        const me = await accountFetchMe();
        if (canceled || readAccountSessionGeneration() !== validationGeneration) return;
        assertAccountIdentity(me, activeUser.id);
        useUserStore.getState().setMe(me);
        setUserState((current) => ({
          ...(current ?? activeUser),
          id: me.id,
          name: me.name,
          username: me.username,
          email: me.email,
          accountCreatedAt: me.created_at,
          currentPlan: me.tier,
        }));
      } catch (error) {
        if (
          canceled ||
          readAccountSessionGeneration() !== validationGeneration ||
          !isInvalidAccountSessionError(error) ||
          accountOperationActive.current
        ) {
          return;
        }

        beginAccountOperation();
        resetAccountScopedState();
        try {
          // The restored account's token is no longer valid. Rather than silently
          // switching to a different saved account, send the user to the chooser
          // where they can pick another account or re-sign-in to this one.
          await deactivateToChooser();
        } catch {
          // A transient persistence failure must not strand the user; keep the
          // account active so the next launch can retry validation.
          await restoreSavedSession(activeUser.id);
          setUserState(activeUser);
          setAccounts(listSavedAccountSessions());
        } finally {
          finishAccountOperation();
        }
      }
    })();
    return () => {
      canceled = true;
    };
    // Validate only the first restored identity. Sign-in and account switching
    // already fetch /me before setting the user.
  }, [activeUser, beginAccountOperation, finishAccountOperation, deactivateToChooser]);

  useEffect(() => {
    if (!activeUser) return;
    let canceled = false;
    const handleInvalidSession = () => {
      if (canceled || accountOperationActive.current) return;
      beginAccountOperation();
      resetAccountScopedState();
      void deactivateToChooser().finally(() => {
        if (!canceled) finishAccountOperation();
      });
    };
    window.addEventListener("misty:account-session-invalid", handleInvalidSession);
    return () => {
      canceled = true;
      window.removeEventListener("misty:account-session-invalid", handleInvalidSession);
    };
  }, [activeUser, beginAccountOperation, deactivateToChooser, finishAccountOperation]);

  // Signing out no longer hops to another saved account. It deactivates the
  // current one — leaving it (and every other account) listed on the sign-in
  // chooser — and never revokes tokens, so the chooser can resume any account
  // whose token is still valid, or prompt a re-login when it isn't.
  const logout = useCallback(async () => {
    if (accountOperationActive.current) return;
    const previousUser = activeUser;
    const previousMe = useUserStore.getState().me;
    beginAccountOperation();
    resetAccountScopedState();
    try {
      await deactivateToChooser();
    } catch (error) {
      if (previousUser) {
        await restoreSavedSession(previousUser.id);
        if (previousMe?.id === previousUser.id) useUserStore.getState().setMe(previousMe);
        setUserState(previousUser);
        refreshAuthenticatedAccountState();
      }
      setAccounts(listSavedAccountSessions());
      throw error;
    } finally {
      finishAccountOperation();
    }
  }, [activeUser, beginAccountOperation, finishAccountOperation, deactivateToChooser]);

  // Resume a saved account chosen from the sign-in screen. Its token is validated
  // against /me; on failure the account stays listed and the error propagates so
  // the chooser can send the person to re-sign-in.
  const resumeAccount = useCallback(
    async (accountId: string) => {
      if (accountOperationActive.current) return;
      beginAccountOperation();
      resetAccountScopedState();
      let accountReady = false;
      try {
        const saved = await activateAccountSession(accountId);
        const me = await accountFetchMe();
        assertAccountIdentity(me, saved.id);
        const nextUser = authUserFromMe(me, saved);
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser, licenseFromMe(me));
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        accountReady = true;
      } catch (error) {
        // Leave the account listed; its token is stale, so the caller re-signs-in.
        await deactivateActiveAccount().catch(() => undefined);
        setAccounts(listSavedAccountSessions());
        throw error;
      } finally {
        finishAccountOperation();
        if (accountReady) refreshAuthenticatedAccountState();
      }
    },
    [beginAccountOperation, finishAccountOperation, saveAuthenticatedUser],
  );

  const removeAccount = useCallback(async (accountId: string) => {
    await removeSavedAccountSession(accountId);
    await removeSpaceReferenceCache(accountId);
    setAccounts(listSavedAccountSessions());
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: activeUser,
        setUser,
        accounts,
        transitioning,
        refreshUser,
        authenticateAccount,
        switchAccount,
        resumeAccount,
        removeAccount,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function resetAccountScopedState(): void {
  useUserStore.getState().clear();
  useExplorerStore.setState({ notifications: [], notificationHistory: [] });
  resetSearchAccountState();
  resetSpacesAccountState();
  resetAllAgentAccountState();
  resetNotesAccountState();
}

function refreshAuthenticatedAccountState(): void {
  void useSpacesStore.getState().load();
  refreshAllAgentAccountState();
}

function authUserFromMe(me: AccountMeResponse, fallback: SavedAccountSession): AuthUser {
  return {
    id: me.id || fallback.id,
    name: me.name || fallback.name,
    username: me.username || fallback.username,
    email: me.email || fallback.email,
    avatarVersion: me.avatar_version,
    accountCreatedAt: me.created_at || fallback.accountCreatedAt,
    currentPlan: me.tier || fallback.currentPlan,
  };
}

function assertAccountIdentity(me: AccountMeResponse, expectedAccountId: string): void {
  if (!me.id || me.id !== expectedAccountId) {
    throw new AccountIdentityMismatchError();
  }
}

function isInvalidAccountSessionError(error: unknown): boolean {
  return isAccountUnauthorizedError(error) || error instanceof AccountIdentityMismatchError;
}

class AccountIdentityMismatchError extends Error {
  name = "AccountIdentityMismatchError";

  constructor() {
    super("The saved Misty session did not match the expected account.");
  }
}

function licenseFromMe(me: AccountMeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

export function useAuth() {
  return useContext(AuthContext);
}

function readStoredUser(): AuthUser | null {
  try {
    const stored = window.localStorage.getItem(authUserStorageKey);
    return stored ? (JSON.parse(stored) as AuthUser) : null;
  } catch {
    return null;
  }
}

function readInitialUser(): AuthUser | null {
  if (!shouldPersistAuthUser) return null;
  const activeSession = readActiveSavedAccountSession();
  const storedUser = readStoredUser();
  if (!activeSession) return storedUser;
  if (storedUser?.id === activeSession.id) {
    return { ...activeSession, ...storedUser, id: activeSession.id };
  }
  return activeSession;
}

function writeStoredUser(user: AuthUser | null): void {
  try {
    if (user) {
      window.localStorage.setItem(authUserStorageKey, JSON.stringify(user));
    } else {
      clearStoredUser();
    }
  } catch {}
}

function clearStoredUser(): void {
  try {
    window.localStorage.removeItem(authUserStorageKey);
  } catch {}
}
