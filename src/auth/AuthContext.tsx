import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { accountFetchMe, accountLogout, isAccountUnauthorizedError } from "../pages/Account/shared/api";
import { clearAccountAuthToken } from "../pages/Account/shared/authTokenStore";
import { isNativeMobileBuild } from "../platform/buildTarget";
import { useSetupStore } from "../stores/useSetupStore";
import { useUserStore } from "../stores/useUserStore";
import { setAnalyticsAuthenticationState } from "../analytics/lifecycle";
import { TelemetryIdentityManager } from "../analytics/identity";
import { analytics } from "../analytics/client";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  accountCreatedAt?: string;
  currentPlan?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => {},
  logout: () => {},
});

const shouldPersistAuthUser = !isNativeMobileBuild;
const authUserStorageKey = "misty_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const signOut = useSetupStore((state) => state.signOut);
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(() =>
    shouldPersistAuthUser ? readStoredUser() : null,
  );
  const [telemetryIdentity] = useState(() => new TelemetryIdentityManager(analytics));

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
    if (!user) return;
    let canceled = false;
    void accountFetchMe().then((me) => {
      if (canceled) return;
      setUser((current) => current ? {
        ...current,
        id: me.id,
        name: me.name,
        email: me.email,
        accountCreatedAt: me.created_at,
        currentPlan: me.tier,
      } : null);
    }).catch((error) => {
      if (canceled || !isAccountUnauthorizedError(error)) return;
      void clearAccountAuthToken();
      useUserStore.getState().clear();
      void signOut();
      setUser(null);
    });
    return () => {
      canceled = true;
    };
    // Validate only the persisted startup identity. Sign-in itself already
    // validates credentials and fetches /me before setting the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(() => {
    accountLogout().catch(() => {});
    useUserStore.getState().clear();
    void signOut();
    setUser(null);
    navigate("/signin", { replace: true });
  }, [navigate, signOut]);

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
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
