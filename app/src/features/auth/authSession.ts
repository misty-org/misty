import { useActivityStore } from "@/features/activity";
import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { refreshAllAgentAccountState, resetAllAgentAccountState } from "@/features/agents";
import { useExplorerStore } from "@/features/files/explorer";
import { resetSearchAccountState } from "@/features/files/search";
import type { CurrentLicense } from "@/features/installer";
import { resetNotesAccountState } from "@/features/notes";
import { resetSpacesAccountState, useSpacesStore } from "@/features/spaces";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import type { AccountMeResponse } from "./model/stores/account/interfaces/useAccountStore";
import type { SavedAccountSession } from "./model/stores/account/interfaces/useAuthTokenStore";
import { isAccountUnauthorizedError } from "./store/useAccountStore";
import { readActiveSavedAccountSession } from "./store/useAuthTokenStore";
import { useUserStore } from "./store/useUserStore";

export const shouldPersistAuthUser = !isNativeMobileBuild;
const authUserStorageKey = "misty_user";

function scopedAuthUserStorageKey(): string {
  return deploymentStorageKey(authUserStorageKey);
}

export function resetAccountScopedState(): void {
  useUserStore.getState().clear();
  useActivityStore.getState().setAccount("");
  useExplorerStore.setState({ notifications: [], notificationHistory: [] });
  resetSearchAccountState();
  resetSpacesAccountState();
  resetAllAgentAccountState();
  resetNotesAccountState();
}
export function refreshAuthenticatedAccountState(): void {
  void useSpacesStore.getState().load();
  refreshAllAgentAccountState();
}

export function authUserFromMe(me: AccountMeResponse, fallback: SavedAccountSession): AuthUser {
  return {
    id: me.id || fallback.id,
    name: me.name || fallback.name,
    username: me.username || fallback.username,
    email: me.email || fallback.email,
    avatarVersion: me.avatar_version,
    accountCreatedAt: me.created_at || fallback.accountCreatedAt,
    currentPlan: me.tier || fallback.currentPlan,
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

export class AccountIdentityMismatchError extends Error {
  name = "AccountIdentityMismatchError";

  constructor() {
    super("The saved Misty session did not match the expected account.");
  }
}

export function licenseFromMe(me: AccountMeResponse): CurrentLicense {
  return {
    tier: me.tier,
    status: me.status,
    allows_use: me.allows_use,
    expires_at: me.expires_at,
    trial_started_at: me.trial_started_at,
    license_device: me.license_device || null,
  };
}

export function readStoredUser(): AuthUser | null {
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
    return { ...activeSession, ...storedUser, id: activeSession.id };
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
