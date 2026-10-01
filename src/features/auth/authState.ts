import { createContext, useContext } from "react";
import type { AuthContextValue } from "./authSession";

// Keep the context identity outside the provider's application dependency graph.
// Refreshing provider dependencies must not give lazy routes a new context while
// the mounted shell still supplies the previous one. This module has no runtime
// imports from application features.
export const AuthContext = createContext<AuthContextValue>({
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

export function useAuth() {
  return useContext(AuthContext);
}
