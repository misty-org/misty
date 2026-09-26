import { flushWorkspaceRecovery } from "@/features/browser-workspace/recovery";
import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { continueWithTemporaryWorkspace } from "@/features/workspace/nativeWorkspaceRecovery";
import { readApiAuthToken } from "@/api/client/session";
import { apiSessionInvalidEvent } from "@/api/client/session";
import { useSetupStore } from "@/features/installer";
import { removeSpaceReferenceCache } from "@/features/spaces";
import {
  removeAccountWorkspace,
  restoreAccountWorkspace,
  saveAccountWorkspace,
} from "@/features/workspace";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { mobileCachePurgeAccount } from "@/native/mobile-cache";
import { reportSystemError } from "@/features/activity";
import { analytics } from "@/telemetry/client";
import { TelemetryIdentityManager } from "@/telemetry/identity";
import { setAnalyticsAuthenticationState } from "@/telemetry/lifecycle";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  assertAccountIdentity,
  authUserFromMe,
  clearStoredUser,
  isInvalidAccountSessionError,
  licenseFromMe,
  readInitialUser,
  resetAccountScopedState,
  shouldPersistAuthUser,
  writeStoredUser,
  type AuthContextValue,
  type AuthUser,
} from "./authSession";
import type { SavedAccountSession } from "./model/stores/account/interfaces/useAuthTokenStore";
import { restoreSavedSession, tryRestoreSavedSession } from "./sessionRecovery";
import { SavedAccountSessionUnavailableError } from "./sessionErrors";
import { accountFetchMe, accountLogout } from "./store/useAccountStore";
import {
  activateAccountSession,
  clearAccountAuthToken,
  deactivateActiveAccount,
  listSavedAccountSessions,
  readAccountSessionGeneration,
  removeSavedAccountSession,
  setAccountSessionTransitioning,
  updateSavedAccountSession,
} from "./store/useAuthTokenStore";
import { useUserStore } from "./store/useUserStore";
export type { AuthContextValue, AuthUser } from "./authSession";
const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: async () => {},
  accounts: [],
  transitioning: false,
  refreshUser: async () => null,
  authenticateAccount: async (request) => request(),
  switchAccount: async () => {},
  resumeAccount: async () => {},
  removeAccount: async () => {},
  logout: async () => {},
});

/**
 * Restricted identity provider used by a separately packaged official app.
 * The package receives display identity from the host, while every network
 * request continues to use its short-lived, app-scoped runtime credential.
 */
export function OfficialAppAuthProvider(props: { user: AuthUser; children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      user: props.user,
      setUser: async () => undefined,
      accounts: [],
      transitioning: false,
      refreshUser: async () => props.user,
      authenticateAccount: async (request) => request(),
      switchAccount: async () => undefined,
      resumeAccount: async () => undefined,
      removeAccount: async () => undefined,
      logout: async () => undefined,
    }),
    [props.user],
  );
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const signOut = useSetupStore((state) => state.signOut);
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);
  const nativeUser = useSetupStore((state) => state.status?.current_user ?? null);
  const verifiedAccountId = useUserStore((state) => state.me?.id);
  const navigate = useNavigate();
  const [user, setUserState] = useState<AuthUser | null>(() => readInitialUser());
  const [accounts, setAccounts] = useState<SavedAccountSession[]>(() => listSavedAccountSessions());
  const [transitioning, setTransitioning] = useState(false);
  const [telemetryIdentity] = useState(() => new TelemetryIdentityManager(analytics));
  const startupValidationCompleted = useRef(false);
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
  // Saving the workspace and clearing native identity are best-effort: a failed
  // cleanup step is reported, but never leaves the person signed in.
  const deactivateToChooser = useCallback(
    async ({ endSession = false }: { endSession?: boolean } = {}) => {
      const accountId = activeUser?.id ?? "";
      const failures: unknown[] = [];
      const attempt = async (step: () => unknown) => {
        try {
          await step();
        } catch (error) {
          failures.push(error);
        }
      };
      await attempt(flushWorkspaceRecovery);
      if (accountId) await attempt(() => saveAccountWorkspace(accountId));
      // Signing out ends the server session: the account stays listed, but
      // choosing it again asks for the password.
      if (endSession && accountId) await attempt(() => accountLogout(accountId));
      await attempt(deactivateActiveAccount);
      await attempt(signOut);
      if (isNativeMobileBuild && accountId)
        await attempt(() => removeSavedAccountSession(accountId));
      resetAccountScopedState(accountId);
      setUserState(null);
      setAccounts(listSavedAccountSessions());
      navigate("/signin", { replace: true });
      for (const error of failures) {
        reportSystemError({
          accountId,
          scope: "account:sign-out",
          title: "Part of signing out did not finish",
          error,
        });
      }
    },
    [activeUser?.id, navigate, signOut],
  );

  const setUser = useCallback(
    async (nextUser: AuthUser | null) => {
      const currentAccountId = activeUser?.id ?? "";
      if (currentAccountId !== (nextUser?.id ?? "")) {
        await flushWorkspaceRecovery();
        if (currentAccountId) await saveAccountWorkspace(currentAccountId);
        resetAccountScopedState(currentAccountId);
        if (nextUser?.id) await restoreAccountWorkspace(nextUser.id);
      }
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
      beginAccountOperation();
      try {
        await flushWorkspaceRecovery();
        if (previousAccountId) await saveAccountWorkspace(previousAccountId);
        resetAccountScopedState(previousAccountId);
        const saved = await activateAccountSession(accountId);
        const me = await accountFetchMe();
        assertAccountIdentity(me, saved.id);
        const nextUser = authUserFromMe(me, saved);
        // Complete fallible session persistence before committing the visible
        // and native identity. A failed write can then safely reactivate the
        // previous token without leaving the two account identities crossed.
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser, licenseFromMe(me));
        await restoreAccountWorkspace(nextUser.id);
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        if (window.location.pathname.startsWith("/spaces/")) {
          navigate("/browser", { replace: true });
        }
      } catch (error) {
        // Keep the target account listed even when its session is dead: the
        // caller sends the person to sign in again instead of deleting it.
        const restoredPreviousAccount = await tryRestoreSavedSession(previousAccountId);
        if (restoredPreviousAccount) {
          if (previousAccountId) await restoreAccountWorkspace(previousAccountId);
          if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
          if (previousUser?.id === previousAccountId) setUserState(previousUser);
        } else {
          await deactivateActiveAccount().catch(() => undefined);
          useUserStore.getState().clear();
          setUserState(null);
        }
        setAccounts(listSavedAccountSessions());
        throw isInvalidAccountSessionError(error)
          ? new SavedAccountSessionUnavailableError()
          : error;
      } finally {
        finishAccountOperation();
      }
    },
    [activeUser, beginAccountOperation, finishAccountOperation, navigate, saveAuthenticatedUser],
  );

  const authenticateAccount = useCallback(
    async (request: () => Promise<AuthUser>) => {
      const previousUser = activeUser;
      const previousAccountId = previousUser?.id ?? "";
      const previousMe = useUserStore.getState().me;
      const previousLicense = useSetupStore.getState().status?.current_license ?? null;
      let authenticated: AuthUser | null = null;
      beginAccountOperation();
      try {
        await flushWorkspaceRecovery();
        if (previousAccountId) await saveAccountWorkspace(previousAccountId);
        resetAccountScopedState(previousAccountId);
        authenticated = await request();
        const me = await accountFetchMe();
        assertAccountIdentity(me, authenticated.id);
        const nextUser = authUserFromMe(me, {
          ...authenticated,
          lastUsedAt: new Date().toISOString(),
        });
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser, licenseFromMe(me));
        await restoreAccountWorkspace(nextUser.id);
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        if (window.location.pathname.startsWith("/spaces/")) {
          navigate("/browser", { replace: true });
        }
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
            if (previousAccountId) await restoreAccountWorkspace(previousAccountId);
            if (previousMe?.id === previousAccountId) useUserStore.getState().setMe(previousMe);
            if (previousUser?.id === previousAccountId) setUserState(previousUser);
            restoredPreviousAccount = true;
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
      }
    },
    [activeUser, beginAccountOperation, finishAccountOperation, navigate, saveAuthenticatedUser],
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
    if (!nativeWorkspaceRecoveryEnabled() || !activeUser?.id || accountOperationActive.current)
      return;
    const accountId = activeUser.id;
    let canceled = false;
    void (async () => {
      // This restores the OS-held account cookies without requiring a network
      // response. Local layout recovery also works while sync is locked/offline.
      await readApiAuthToken();
      if (canceled || accountOperationActive.current) return;
      await restoreAccountWorkspace(accountId);
    })().catch((error) => {
      if (!canceled && !accountOperationActive.current)
        continueWithTemporaryWorkspace(accountId, error);
    });
    return () => {
      canceled = true;
    };
  }, [activeUser?.id]);

  useEffect(() => {
    // Saved display metadata is not proof that the new server cookies work.
    // Wait for /me before issuing authenticated telemetry requests.
    const verifiedUser = activeUser?.id === verifiedAccountId ? activeUser : null;
    setAnalyticsAuthenticationState(Boolean(verifiedUser));
    telemetryIdentity.sync(verifiedUser);
  }, [activeUser, verifiedAccountId, telemetryIdentity]);

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
    if (!activeUser || startupValidationCompleted.current || accountOperationActive.current) return;
    let canceled = false;
    const validationGeneration = readAccountSessionGeneration();
    void (async () => {
      try {
        const me = await accountFetchMe();
        if (canceled || readAccountSessionGeneration() !== validationGeneration) return;
        assertAccountIdentity(me, activeUser.id);
        startupValidationCompleted.current = true;
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

        startupValidationCompleted.current = true;
        beginAccountOperation();
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
    let validating = false;
    const handleInvalidSession = () => {
      if (canceled || validating || accountOperationActive.current) return;
      validating = true;
      const generation = readAccountSessionGeneration();
      // A delayed or resource-specific 401 is not proof that the current
      // account is signed out. Coalesce failures and validate before changing
      // identity or navigating; /me can itself emit this event.
      void (async () => {
        try {
          const me = await accountFetchMe();
          if (canceled || readAccountSessionGeneration() !== generation) return;
          assertAccountIdentity(me, activeUser.id);
        } catch (error) {
          if (
            canceled ||
            accountOperationActive.current ||
            readAccountSessionGeneration() !== generation ||
            !isInvalidAccountSessionError(error)
          )
            return;
          beginAccountOperation();
          try {
            await deactivateToChooser();
          } finally {
            // Deactivation cleans up this effect; still release the transition.
            finishAccountOperation();
          }
        } finally {
          validating = false;
        }
      })().catch(() => undefined);
    };
    window.addEventListener(apiSessionInvalidEvent, handleInvalidSession);
    return () => {
      canceled = true;
      window.removeEventListener(apiSessionInvalidEvent, handleInvalidSession);
    };
  }, [activeUser, beginAccountOperation, deactivateToChooser, finishAccountOperation]);

  // Signing out ends the current account's server session and returns to the
  // chooser. The account stays listed, but resuming it requires its password;
  // other saved accounts keep their sessions.
  const logout = useCallback(async () => {
    if (accountOperationActive.current) return;
    beginAccountOperation();
    try {
      await deactivateToChooser({ endSession: true });
    } finally {
      finishAccountOperation();
    }
  }, [beginAccountOperation, finishAccountOperation, deactivateToChooser]);

  // Resume a saved account chosen from the sign-in screen. Its token is validated
  // against /me; on failure the account stays listed and the error propagates so
  // the chooser can send the person to re-sign-in.
  const resumeAccount = useCallback(
    async (accountId: string) => {
      beginAccountOperation();
      const previousAccountId = activeUser?.id ?? "";
      try {
        await flushWorkspaceRecovery();
        if (previousAccountId) await saveAccountWorkspace(previousAccountId);
        resetAccountScopedState(previousAccountId);
        const saved = await activateAccountSession(accountId);
        const me = await accountFetchMe();
        assertAccountIdentity(me, saved.id);
        const nextUser = authUserFromMe(me, saved);
        await updateSavedAccountSession(nextUser);
        await saveAuthenticatedUser(nextUser, licenseFromMe(me));
        await restoreAccountWorkspace(nextUser.id);
        useUserStore.getState().setMe(me);
        setUserState(nextUser);
        setAccounts(listSavedAccountSessions());
        if (window.location.pathname.startsWith("/spaces/")) {
          navigate("/browser", { replace: true });
        }
      } catch (error) {
        // Keep the account listed so transient failures can be retried. Only
        // confirmed invalid sessions should send the chooser to password entry.
        await deactivateActiveAccount().catch(() => undefined);
        setAccounts(listSavedAccountSessions());
        throw isInvalidAccountSessionError(error)
          ? new SavedAccountSessionUnavailableError()
          : error;
      } finally {
        finishAccountOperation();
      }
    },
    [
      activeUser?.id,
      beginAccountOperation,
      finishAccountOperation,
      navigate,
      saveAuthenticatedUser,
    ],
  );

  const removeAccount = useCallback(async (accountId: string) => {
    if (!(await removeSavedAccountSession(accountId)))
      throw new Error("Could not remove the saved account. Its workspace has been preserved.");
    await removeSpaceReferenceCache(accountId);
    await removeAccountWorkspace(accountId);
    if (isNativeMobileBuild) await mobileCachePurgeAccount(accountId);
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

export function useAuth() {
  return useContext(AuthContext);
}
