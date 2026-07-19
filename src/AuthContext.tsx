import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { logoutRequest } from "./pages/Dashboard/api";
import { useUserStore } from "./store/userStore";

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  logout: () => {},
});

interface AuthProviderProps {
  children: React.ReactNode;
  onLogout?: () => void | Promise<void>;
}

export function AuthProvider({ children, onLogout }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("misty_user");
      return stored ? (JSON.parse(stored) as User) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem("misty_user", JSON.stringify(user));
      } else {
        localStorage.removeItem("misty_user");
      }
    } catch {
      // Authentication remains usable for the current session without storage.
    }
  }, [user]);

  const navigate = useNavigate();

  const logout = useCallback(() => {
    logoutRequest().catch(() => {});
    useUserStore.getState().clear();
    void onLogout?.();
    setUser(null);
    navigate("/");
  }, [navigate, onLogout]);

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
