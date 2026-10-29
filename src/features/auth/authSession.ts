import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { clearSystemErrors } from "@/features/support/systemErrors";
import { resetAiSurfaceAccountState } from "@/features/ai-surface";
import { useAppRouteMemoryStore } from "@/features/app-shell";
import { resetNotesAccountState } from "@/features/journal/notes";
import { resetSpacesAccountState } from "@/features/spaces";
import { resetWorkspaceAccountState } from "@/features/workspace";
import type { AccountMeResponse } from "@/api/account/types";
import type { SavedAccountSession } from "./store/accountVault";
import { notifyAccountScopeReset, notifyAccountScopeWillReset } from "./store/accountEvents";
import { isAccountUnauthorizedError } from "./store/useAccountStore";
import { readActiveSavedAccountSession } from "./store/useAuthTokenStore";
import { useUserStore } from "./store/useUserStore";
export const shouldPersistAuthUser = true;
const authUserStorageKey = "misty_user";
function scopedAuthUserStorageKey(): string {
  return deploymentStorageKey(authUserStorageKey);
}
export function resetAccountScopedState(previousAccountId?: string): void {
  notifyAccountScopeWillReset();
  useUserStore.getState().clear();
  clearSystemErrors();
  resetSpacesAccountState();
  resetNotesAccountState();
  resetWorkspaceAccountState();
  useAppRouteMemoryStore.getState().resetAppRoute();
  resetAiSurfaceAccountState(previousAccountId);
  notifyAccountScopeReset();
}
export function authUserFromMe(me: AccountMeResponse, fallback: SavedAccountSession): AuthUser {
  return {
    id: me.id || fallback.id,
    username: me.username || fallback.username,
    email: me.email || fallback.email,
    avatarVersion: me.avatar_version,
    accountCreatedAt: me.created_at || fallback.accountCreatedAt,
  };
}
export function assertAccountIdentity(me: AccountMeResponse, expectedAccountId: string): void {
  if (!me.id || me.id !== expectedAccountId) {
    throw new AccountIdentityMismatchError();
  }
}
export function isInvalidAccountSessionError(error: unknown): boolean {
  return isAccountUnauthorizedError(error) || error instanceof AccountIdentityMismatchError;
}
class AccountIdentityMismatchError extends Error {
  name = "AccountIdentityMismatchError";
  constructor() {
    super("The saved Misty session did not match the expected account.");
  }
}
function readStoredUser(): AuthUser | null {
  try {
    const stored = readDeploymentStorageItem(authUserStorageKey);
    return stored ? (JSON.parse(stored) as AuthUser) : null;
  } catch {
    return null;
  }
}
export function readInitialUser(): AuthUser | null {
  if (!shouldPersistAuthUser) return null;
  const activeSession = readActiveSavedAccountSession();
  const storedUser = readStoredUser();
  if (!activeSession) return storedUser;
  if (storedUser?.id === activeSession.id) {
    return {
      ...activeSession,
      ...storedUser,
      id: activeSession.id,
    };
  }
  return activeSession;
}
export function writeStoredUser(user: AuthUser | null): void {
  try {
    if (user) {
      window.localStorage.setItem(scopedAuthUserStorageKey(), JSON.stringify(user));
    } else {
      clearStoredUser();
    }
  } catch {}
}
export function clearStoredUser(): void {
  try {
    window.localStorage.removeItem(scopedAuthUserStorageKey());
  } catch {}
}
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  avatarVersion?: number;
  accountCreatedAt?: string;
}
export interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => Promise<void>;
  accounts: SavedAccountSession[];
  transitioning: boolean;
  /** The server rejected the account's session. Browsing carries on; sync and agents wait
   * until the person signs in again. */
  sessionExpired: boolean;
  /** Keys the app's page tree. It stays the same when signing in adopts the local profile or
   * signing out returns to it, so the window keeps its pages; switching between two accounts
   * changes it and starts the app over. */
  outletKey: string;
  refreshUser: () => Promise<AuthUser | null>;
  authenticateAccount: (request: () => Promise<AuthUser>) => Promise<AuthUser>;
  switchAccount: (accountId: string) => Promise<void>;
  resumeAccount: (accountId: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  /** Signs out and keeps browsing on the local profile; `removeData` erases this device's
   * browsing data instead of keeping it. */
  logout: (options?: { removeData?: boolean }) => Promise<void>;
}
