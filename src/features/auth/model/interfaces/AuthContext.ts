import type { SavedAccountSession } from "../stores/account/interfaces/useAuthTokenStore";

export interface AuthUser {
  id: string;
  name: string;
  username?: string;
  email: string;
  avatarVersion?: number;
  accountCreatedAt?: string;
  currentPlan?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  accounts: SavedAccountSession[];
  transitioning: boolean;
  refreshUser: () => Promise<AuthUser | null>;
  authenticateAccount: (request: () => Promise<AuthUser>) => Promise<AuthUser>;
  switchAccount: (accountId: string) => Promise<void>;
  resumeAccount: (accountId: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  logout: () => Promise<void>;
}
