import type { AuthUser } from "@/features/auth/authSession";
import type { SavedAccountSession } from "@/features/auth/model/stores/account/interfaces/useAuthTokenStore";
import type { AccountMeResponse } from "@/api/account/types";
import { useUserStore } from "@/features/auth/store/useUserStore";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { OfficialAppPackageSession } from "./types";

export type { AuthUser } from "@/features/auth/authSession";
export type { AccountMeResponse } from "@/api/account/types";
export { useUserStore } from "@/features/auth/store/useUserStore";

export const accountScopeResetEvent = "misty:account-scope-reset";

interface PackageAuthRuntime {
  generation: () => number;
  session: () => OfficialAppPackageSession | undefined;
  user: () => AuthUser | null;
}

let runtime: PackageAuthRuntime = {
  generation: () => 0,
  session: () => undefined,
  user: () => null,
};

export function configureOfficialAppAuthRuntime(next: PackageAuthRuntime) {
  runtime = next;
}

interface AuthContextValue {
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

const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => undefined,
  accounts: [],
  transitioning: false,
  refreshUser: async () => null,
  authenticateAccount: async (request) => request(),
  switchAccount: async () => undefined,
  resumeAccount: async () => undefined,
  removeAccount: async () => undefined,
  logout: async () => undefined,
});

export function OfficialAppAuthProvider(props: { user: AuthUser; children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      user: props.user,
      setUser: () => undefined,
      accounts: [],
      transitioning: false,
      refreshUser: async () => props.user,
      authenticateAccount: async (request) => request(),
      switchAccount: async () => undefined,
      resumeAccount: async () => undefined,
      removeAccount: async () => undefined,
      logout: async () => undefined,
    }),
    [props.user],
  );
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function readAccountSessionGeneration(): number {
  return runtime.generation();
}

export function isAccountSessionTransitioning(): boolean {
  return false;
}

export async function readAccountAuthToken(): Promise<string | null> {
  return null;
}

export function readActiveSavedAccountSession(): SavedAccountSession | null {
  const user = runtime.user();
  if (!user) return null;
  return { ...user, lastUsedAt: new Date().toISOString() };
}

export function useAccountAvatarUrl(
  accountId: string | null | undefined,
  avatarVersion: number | null | undefined,
): string {
  const [avatarUrl, setAvatarUrl] = useState("");
  useEffect(() => {
    setAvatarUrl("");
    if (!accountId || !avatarVersion || avatarVersion < 1) return;
    let disposed = false;
    let objectUrl = "";
    void fetchOfficialAppAvatar()
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setAvatarUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [accountId, avatarVersion]);
  return avatarUrl;
}

async function fetchOfficialAppAvatar(): Promise<Blob> {
  const session = runtime.session();
  if (!session) throw new Error("The app session is unavailable.");
  const response = await fetch("https://misty-sdk.local/me/avatar", { credentials: "omit" });
  if (!response.ok) throw new Error(`Profile image request failed (${response.status}).`);
  return response.blob();
}

export async function accountFetchMe(): Promise<AccountMeResponse> {
  const session = runtime.session();
  if (!session) throw new Error("The app session is unavailable.");
  const response = await fetch("https://misty-sdk.local/me", { credentials: "omit" });
  if (!response.ok) throw new Error(`Account request failed (${response.status}).`);
  return (await response.json()) as AccountMeResponse;
}
