import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { clearSystemErrors } from "@/shared/platform/system_errors";
import { useAppRouteMemoryStore } from "@/app/shell";
import { accountResets } from "../account_seams";
import { resetWorkspaceAccountState } from "@/features/app-windows";
import type { AccountMeResponse } from "../api/account_types";
import { readAvatarDecoration, type AvatarDecoration } from "@/shared/lib/avatar_decoration";
import type { SavedAccountSession } from "./account_vault";
import { notifyAccountScopeReset, notifyAccountScopeWillReset } from "./account_events";
import { isAccountUnauthorizedError } from "./use_account_store";
import { readActiveSavedAccountSession } from "./use_auth_token_store";
import { useUserStore } from "./use_user_store";
export const shouldPersistAuthUser = true;
const authUserStorageKey = "misty_user";
function scopedAuthUserStorageKey(): string {
  return deploymentStorageKey(authUserStorageKey);
}
export function resetAccountScopedState(previousAccountId?: string): void {
  notifyAccountScopeWillReset();
  useUserStore.getState().clear();
  clearSystemErrors();
  accountResets.run(previousAccountId);
  resetWorkspaceAccountState();
  useAppRouteMemoryStore.getState().resetAppRoute();
  notifyAccountScopeReset();
}
export function authUserFromMe(me: AccountMeResponse, fallback: SavedAccountSession): AuthUser {
  return {
    id: me.id || fallback.id,
    username: me.username || fallback.username,
    email: me.email || fallback.email,
    avatarVersion: me.avatar_version,
    avatarDecoration: readAvatarDecoration(me.avatar_decoration),
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
  avatarDecoration?: AvatarDecoration;
  accountCreatedAt?: string;
}
export interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => Promise<void>;
  accounts: SavedAccountSession[];
  transitioning: boolean;
  sessionExpired: boolean;
  outletKey: string;
  refreshUser: () => Promise<AuthUser | null>;
  authenticateAccount: (request: () => Promise<AuthUser>) => Promise<AuthUser>;
  switchAccount: (accountId: string) => Promise<void>;
  resumeAccount: (accountId: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  logout: (options?: { removeData?: boolean }) => Promise<void>;
}
