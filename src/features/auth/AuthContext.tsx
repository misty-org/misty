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
import {
  accountFetchMe,
  accountLogout,
  accountRevokeCurrentSession,
  isAccountUnauthorizedError,
} from "@/stores/account/useAccountStore";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";
import {
  activateAccountSession,
  clearAccountAuthToken,
  listSavedAccountSessions,
  readAccountSessionGeneration,
  removeSavedAccountSession,
  setAccountSessionTransitioning,
  updateSavedAccountSession,
} from "@/stores/account/useAuthTokenStore";
import type { SavedAccountSession } from "@/models/interfaces/stores/account/useAuthTokenStore";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import type { CurrentLicense } from "@/models/types/features/installer/types";
import { resetMikaAccountState, useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";
import { resetSpacesAccountState, useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { resetNotesAccountState } from "@/stores/notes/useNotesStore";
import { useSetupStore } from "@/stores/app";
import { resetSearchAccountState, useExplorerStore } from "@/stores/explorer";
import { useUserStore } from "@/stores/account/useUserStore";
import { setAnalyticsAuthenticationState } from "@/analytics/lifecycle";
import { TelemetryIdentityManager } from "@/analytics/identity";
import { analytics } from "@/analytics/client";

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => {},
  accounts: [],
  transitioning: false,
  authenticateAccount: async (request) => request(),
  switchAccount: async () => {},
  logout: async () => {},
});

const shouldPersistAuthUser = !isNativeMobileBuild;
const authUserStorageKey = "misty_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const signOut = useSetupStore((state) => state.signOut);
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);
  const nativeUser = useSetupStore((state) => state.status?.current_user ?? null);
  const navigate = useNavigate();
  const [user, setUserState] = useState<AuthUser | null>(() =>
    shouldPersistAuthUser ? readStoredUser() : null,
  );
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

  const findValidatedFallback = useCallback(async (excludedAccountId: string) => {
    const candidates = listSavedAccountSessions().filter(
      (account) => account.id !== excludedAccountId,
    );
    for (const candidate of candidates) {
      try {
        const fallback = await activateAccountSession(candidate.id);
        const me = await accountFetchMe();
        assertAccountIdentity(me, fallback.id);
        const nextUser = authUserFromMe(me, fallback);
        return { me, user: nextUser };
      } catch (error) {
        if (isInvalidAccountSessionError(error)) {
          await clearAccountAuthToken();
          continue;
        }
        await restoreSavedSession(excludedAccountId);
        throw error;
      }
    }
    await restoreSavedSession(excludedAccountId);
    return null;
  }, []);

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
        if (
          previousAccountId &&
          listSavedAccountSessions().some((account) => account.id === previousAccountId)
        ) {
          await activateAccountSession(previousAccountId);
          if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
          if (previousUser?.id === previousAccountId) setUserState(previousUser);
          accountReady = true;
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
        if (
          previousAccountId &&
          listSavedAccountSessions().some((account) => account.id === previousAccountId)
        ) {
          await activateAccountSession(previousAccountId);
          if (previousUser && previousLicense) {
            await saveAuthenticatedUser(previousUser, previousLicense);
          }
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

        let accountReady = false;
        beginAccountOperation();
        resetAccountScopedState();
        try {
          const validated = await findValidatedFallback(activeUser.id);
          if (validated) {
            await updateSavedAccountSession(validated.user);
            await saveAuthenticatedUser(validated.user, licenseFromMe(validated.me));
            await removeSavedAccountSession(activeUser.id);
            useUserStore.getState().setMe(validated.me);
            setUserState(validated.user);
            setAccounts(listSavedAccountSessions());
            accountReady = true;
            return;
          }
          useUserStore.getState().clear();
          await signOut();
          await clearAccountAuthToken();
          setUserState(null);
          setAccounts(listSavedAccountSessions());
        } catch {
          // A transient fallback or persistence failure must not delete saved
          // sessions or cross the native identity with another account token.
          await restoreSavedSession(activeUser.id);
          setUserState(activeUser);
          setAccounts(listSavedAccountSessions());
        } finally {
          finishAccountOperation();
          if (accountReady) refreshAuthenticatedAccountState();
        }
      }
    })();
    return () => {
      canceled = true;
    };
    // Validate only the first restored identity. Sign-in and account switching
    // already fetch /me before setting the user.
  }, [activeUser, beginAccountOperation, finishAccountOperation, signOut, findValidatedFallback]);

  const logout = useCallback(async () => {
    if (accountOperationActive.current) return;
    await (async () => {
      const previousUser = activeUser;
      const previousMe = useUserStore.getState().me;
      let accountReady = false;
      beginAccountOperation();
      resetAccountScopedState();
      try {
        const validated = previousUser ? await findValidatedFallback(previousUser.id) : null;
        if (validated) {
          await updateSavedAccountSession(validated.user);
          await restoreSavedSession(previousUser?.id ?? "");
          await accountRevokeCurrentSession();
          await activateAccountSession(validated.user.id);
          await saveAuthenticatedUser(validated.user, licenseFromMe(validated.me));
          await removeSavedAccountSession(previousUser?.id ?? "");
          useUserStore.getState().setMe(validated.me);
          setUserState(validated.user);
          setAccounts(listSavedAccountSessions());
          accountReady = true;
          return;
        }
        await restoreSavedSession(previousUser?.id ?? "");
        await signOut();
        await accountLogout();
        useUserStore.getState().clear();
        setUserState(null);
        setAccounts(listSavedAccountSessions());
        navigate("/signin", { replace: true });
      } catch (error) {
        if (previousUser) {
          await restoreSavedSession(previousUser.id);
          if (previousMe?.id === previousUser.id) useUserStore.getState().setMe(previousMe);
          setUserState(previousUser);
          accountReady = true;
        }
        setAccounts(listSavedAccountSessions());
        throw error;
      } finally {
        finishAccountOperation();
        if (accountReady) refreshAuthenticatedAccountState();
      }
    })();
  }, [
    activeUser,
    beginAccountOperation,
    finishAccountOperation,
    navigate,
    signOut,
    findValidatedFallback,
  ]);

  return (
    <AuthContext.Provider
      value={{
        user: activeUser,
        setUser,
        accounts,
        transitioning,
        authenticateAccount,
        switchAccount,
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
  resetMikaAccountState();
  resetNotesAccountState();
}

function refreshAuthenticatedAccountState(): void {
  void useSpacesStore.getState().load();
  void useMikaSessionStore.getState().refreshStatus();
}

function authUserFromMe(me: AccountMeResponse, fallback: SavedAccountSession): AuthUser {
  return {
    id: me.id || fallback.id,
    name: me.name || fallback.name,
    username: me.username || fallback.username,
    email: me.email || fallback.email,
    accountCreatedAt: me.created_at || fallback.accountCreatedAt,
    currentPlan: me.tier || fallback.currentPlan,
  };
}

async function restoreSavedSession(accountId: string): Promise<void> {
  if (!accountId) return;
  if (!listSavedAccountSessions().some((account) => account.id === accountId)) return;
  await activateAccountSession(accountId);
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

function writeStoredUser(user: AuthUser | null): void {
  try {
    if (user) {
      window.localStorage.setItem(authUserStorageKey, JSON.stringify(user));
    } else {
      clearStoredUser();
    }
  } catch {
    // Browser privacy modes can disable localStorage; auth state remains in memory.
  }
}

function clearStoredUser(): void {
  try {
    window.localStorage.removeItem(authUserStorageKey);
  } catch {
    // Browser privacy modes can disable localStorage; auth state remains in memory.
  }
}
