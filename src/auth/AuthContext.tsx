import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { accountLogout } from "../pages/Account/shared/api";
import { isNativeMobileBuild } from "../platform/buildTarget";
import { useSetupStore } from "../stores/useSetupStore";
import { useUserStore } from "../stores/useUserStore";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
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

  useEffect(() => {
    if (shouldPersistAuthUser) {
      writeStoredUser(user);
    } else {
      clearStoredUser();
    }
  }, [user]);

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
