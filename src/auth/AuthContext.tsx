import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { accountFetchMe, accountLogout, isAccountUnauthorizedError, type AccountMeResponse } from "../pages/Account/shared/api";
import {
  activateAccountSession,
  clearAccountAuthToken,
  listSavedAccountSessions,
  updateSavedAccountSession,
  type SavedAccountSession,
} from "../pages/Account/shared/authTokenStore";
import { isNativeMobileBuild } from "../platform/buildTarget";
import type { CurrentLicense } from "../models/setup";
import { resetAgentsAccountState } from "../stores/useAgentsStore";
import { resetMikaAccountState } from "../stores/useMikaSessionStore";
import { resetSpacesAccountState } from "../stores/useSpacesStore";
import { useSetupStore } from "../stores/useSetupStore";
import { useUserStore } from "../stores/useUserStore";
import { setAnalyticsAuthenticationState } from "../analytics/lifecycle";
import { TelemetryIdentityManager } from "../analytics/identity";
import { analytics } from "../analytics/client";

export interface AuthUser {
  id: string;
  name: string;
  username?: string;
  email: string;
  accountCreatedAt?: string;
  currentPlan?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  accounts: SavedAccountSession[];
  switchAccount: (accountId: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => {},
  accounts: [],
  switchAccount: async () => {},
  logout: () => {},
});

const shouldPersistAuthUser = !isNativeMobileBuild;
const authUserStorageKey = "misty_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const signOut = useSetupStore((state) => state.signOut);
  const saveAuthenticatedUser = useSetupStore((state) => state.saveAuthenticatedUser);
  const navigate = useNavigate();
  const [user, setUserState] = useState<AuthUser | null>(() =>
    shouldPersistAuthUser ? readStoredUser() : null,
  );
  const [accounts, setAccounts] = useState<SavedAccountSession[]>(() => listSavedAccountSessions());
  const [telemetryIdentity] = useState(() => new TelemetryIdentityManager(analytics));

  const setUser = useCallback((nextUser: AuthUser | null) => {
    if (user?.id && nextUser?.id && user.id !== nextUser.id) resetAccountScopedState();
    setUserState(nextUser);
    setAccounts(listSavedAccountSessions());
  }, [user?.id]);

  const switchAccount = useCallback(async (accountId: string) => {
    if (accountId === user?.id) return;
    const previousAccountId = user?.id ?? "";
    try {
      const saved = await activateAccountSession(accountId);
      const me = await accountFetchMe();
      const nextUser = authUserFromMe(me, saved);
      await saveAuthenticatedUser(nextUser, licenseFromMe(me));
      resetAccountScopedState();
      useUserStore.getState().setMe(me);
      setUserState(nextUser);
      await updateSavedAccountSession(nextUser);
      setAccounts(listSavedAccountSessions());
    } catch (error) {
      if (isAccountUnauthorizedError(error)) await clearAccountAuthToken();
      if (previousAccountId && listSavedAccountSessions().some((account) => account.id === previousAccountId)) {
        await activateAccountSession(previousAccountId);
      }
      setAccounts(listSavedAccountSessions());
      throw error;
    }
  }, [saveAuthenticatedUser, user?.id]);

  useEffect(() => {
    setAnalyticsAuthenticationState(Boolean(user));
    telemetryIdentity.sync(user);
  }, [telemetryIdentity, user]);

  useEffect(() => {
    if (shouldPersistAuthUser) {
      writeStoredUser(user);
    } else {
      clearStoredUser();
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setAccounts(listSavedAccountSessions());
      return;
    }
    void updateSavedAccountSession(user).then(() => setAccounts(listSavedAccountSessions()));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let canceled = false;
    void accountFetchMe().then((me) => {
      if (canceled) return;
      setUserState((current) => current ? {
        ...current,
        id: me.id,
        name: me.name,
        username: me.username,
        email: me.email,
        accountCreatedAt: me.created_at,
        currentPlan: me.tier,
      } : null);
    }).catch((error) => {
      if (canceled || !isAccountUnauthorizedError(error)) return;
      void clearAccountAuthToken().then(async (fallback) => {
        resetAccountScopedState();
        if (fallback) {
          try {
            const me = await accountFetchMe();
            const nextUser = authUserFromMe(me, fallback);
            await saveAuthenticatedUser(nextUser, licenseFromMe(me));
            useUserStore.getState().setMe(me);
            setUserState(nextUser);
            setAccounts(listSavedAccountSessions());
            return;
          } catch {
            // Fall through to a fully signed-out state when no saved session validates.
          }
        }
        useUserStore.getState().clear();
        await signOut();
        setUserState(null);
        setAccounts(listSavedAccountSessions());
      });
    });
    return () => {
      canceled = true;
    };
    // Validate only the persisted startup identity. Sign-in itself already
    // validates credentials and fetches /me before setting the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(() => {
    void (async () => {
      const fallback = await accountLogout().catch(() => null);
      resetAccountScopedState();
      useUserStore.getState().clear();
      if (fallback) {
        try {
          const me = await accountFetchMe();
          const nextUser = authUserFromMe(me, fallback);
          await saveAuthenticatedUser(nextUser, licenseFromMe(me));
          useUserStore.getState().setMe(me);
          setUserState(nextUser);
          setAccounts(listSavedAccountSessions());
          return;
        } catch {
          // If the fallback expired too, finish signing out below.
        }
      }
      await signOut();
      setUserState(null);
      setAccounts(listSavedAccountSessions());
      navigate("/signin", { replace: true });
    })();
  }, [navigate, saveAuthenticatedUser, signOut]);

  return (
    <AuthContext.Provider value={{ user, setUser, accounts, switchAccount, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function resetAccountScopedState(): void {
  useUserStore.getState().clear();
  resetSpacesAccountState();
  resetAgentsAccountState();
  resetMikaAccountState();
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
    return stored ? JSON.parse(stored) as AuthUser : null;
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
