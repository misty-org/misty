import { createContext, useContext } from "react";
import type { AuthContextValue } from "./auth_session";

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: async () => {},
  accounts: [],
  transitioning: false,
  sessionExpired: false,
  outletKey: "local",
  refreshUser: async () => null,
  authenticateAccount: async (request) => request(),
  switchAccount: async () => {},
  resumeAccount: async () => {},
  removeAccount: async () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
