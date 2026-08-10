import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  fetchMe,
  logoutRequest,
  type MeResponse,
} from "./pages/AccountSettings/api";
import { safeInternalPath } from "./lib/navigation";
import { useUserStore } from "./store/userStore";

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  sessionReady: boolean;
  setUser: (user: User | null) => void;
  refreshSession: () => Promise<MeResponse>;
  logout: (destination?: string) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  sessionReady: false,
  setUser: () => {},
  refreshSession: () => Promise.reject(new Error("AuthProvider is unavailable")),
  logout: () => {},
});

interface AuthProviderProps {
  children: React.ReactNode;
  onLogout?: () => void | Promise<void>;
}

export function AuthProvider({ children, onLogout }: AuthProviderProps) {
  const [user, setUserState] = useState<User | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionRevision = useRef(0);

  const setUser = useCallback((nextUser: User | null) => {
    sessionRevision.current += 1;
    setUserState(nextUser);
    setSessionReady(true);
  }, []);

  const refreshSession = useCallback(async () => {
    const revision = sessionRevision.current + 1;
    sessionRevision.current = revision;

    try {
      const account = await fetchMe();
      if (sessionRevision.current === revision) {
        useUserStore.getState().setMe(account);
        setUserState({
          id: account.id,
          name: account.name,
          email: account.email,
        });
      }
      return account;
    } catch (error) {
      if (sessionRevision.current === revision) {
        useUserStore.getState().clear();
        setUserState(null);
      }
      throw error;
    } finally {
      if (sessionRevision.current === revision) {
        setSessionReady(true);
      }
    }
  }, []);

  useEffect(() => {
    void refreshSession().catch(() => {
      // A missing or expired HttpOnly session cookie means signed out.
    });
  }, [refreshSession]);

  const logout = useCallback(
    (destination?: string) => {
      useUserStore.getState().clear();
      setUser(null);
      void (async () => {
        try {
          await logoutRequest();
        } catch {
          // The local session is still cleared if the server is unavailable.
        }
        try {
          await onLogout?.();
        } finally {
          // This hard navigation always wins over any router navigate() the
          // caller may also have issued, so the destination has to be passed in
          // here rather than raced against.
          window.location.replace(safeInternalPath(destination) ?? "/");
        }
      })();
    },
    [onLogout, setUser],
  );

  return (
    <AuthContext.Provider
      value={{ user, sessionReady, setUser, refreshSession, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
