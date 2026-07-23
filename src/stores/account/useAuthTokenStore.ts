import type {
  SavedAccountSession,
  SecureAccountSession,
  SecureAccountVault,
} from "@/models/interfaces/stores/account/useAuthTokenStore";
export type {
  SavedAccountSession,
  SecureAccountSession,
  SecureAccountVault,
} from "@/models/interfaces/stores/account/useAuthTokenStore";
import { remove, retrieve, store } from "@impierce/tauri-plugin-keystore";
import { invoke } from "@tauri-apps/api/core";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import { hasTauriInternals } from "@/platform/tauri";

const desktopTokenService = "com.impierce.identity-wallet";
const desktopTokenUser = "tester";
const tokenStoredMarkerKey = "misty:account-auth-token:keychain-present";
const accountIndexKey = "misty:account-sessions";
const activeAccountKey = "misty:active-account-id";
const legacyUserKey = "misty_user";

let cachedToken: string | null | undefined;
let cachedVault: SecureAccountVault | undefined;
let accountSessionTransitioning = false;
let accountSessionGeneration = 0;

export function setAccountSessionTransitioning(transitioning: boolean): void {
  if (transitioning && !accountSessionTransitioning) accountSessionGeneration += 1;
  accountSessionTransitioning = transitioning;
}

export function isAccountSessionTransitioning(): boolean {
  return accountSessionTransitioning;
}

export function readAccountSessionGeneration(): number {
  return accountSessionGeneration;
}

export async function saveAccountAuthToken(
  token: string,
  account?: Omit<SavedAccountSession, "lastUsedAt">,
): Promise<void> {
  if (cachedToken !== undefined && cachedToken !== (token || null)) accountSessionGeneration += 1;
  cachedToken = token || null;
  if (!token || !hasTauriInternals()) return;

  if (isNativeMobileBuild || !account?.id) {
    await persistRawToken(token);
    return;
  }

  try {
    const vault = await loadSecureVault();
    const saved: SavedAccountSession = {
      ...account,
      lastUsedAt: new Date().toISOString(),
    };
    const sessions = vault.sessions.filter((item) => item.account.id !== saved.id);
    sessions.push({ account: saved, token });
    await persistSecureVault({ version: 1, activeAccountId: saved.id, sessions });
  } catch (error) {
    recordTokenDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not store Misty account sessions in the device keystore.",
      detail: errorDetail(error),
    });
    // Keep the new token active in memory without overwriting an existing vault.
    await syncManagedAiToken(token);
  }
}

export async function readAccountAuthToken(): Promise<string | null> {
  if (!hasTauriInternals()) {
    return import.meta.env.DEV && import.meta.env.VITE_MISTY_DEMO_MODE === "1"
      ? (cachedToken ?? null)
      : null;
  }
  if (cachedToken !== undefined) return cachedToken;

  try {
    if (isNativeMobileBuild) {
      cachedToken = await retrieve(desktopTokenService, desktopTokenUser);
    } else {
      const vault = await loadSecureVault();
      const active = selectActiveSession(vault);
      cachedToken = active?.token ?? null;
      if (active && vault.activeAccountId !== active.account.id) {
        vault.activeAccountId = active.account.id;
        await persistSecureVault(vault);
      }
    }
    writeTokenStoredMarker(Boolean(cachedToken));
    await syncManagedAiToken(cachedToken ?? "");
  } catch (error) {
    cachedToken = null;
    writeTokenStoredMarker(false);
    recordTokenDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not read Misty account sessions from the device keystore.",
      detail: errorDetail(error),
    });
  }
  return cachedToken;
}

export function listSavedAccountSessions(): SavedAccountSession[] {
  try {
    const raw = localStorage.getItem(accountIndexKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    const activeId = readActiveAccountId();
    return parsed.filter(isSavedAccountSession).sort((left, right) => {
      if (left.id === activeId) return -1;
      if (right.id === activeId) return 1;
      return right.lastUsedAt.localeCompare(left.lastUsedAt);
    });
  } catch {
    return [];
  }
}

export function readActiveSavedAccountSession(): SavedAccountSession | null {
  const activeAccountId = readActiveAccountId();
  if (!activeAccountId) return null;
  return listSavedAccountSessions().find((account) => account.id === activeAccountId) ?? null;
}

export async function updateSavedAccountSession(
  account: Omit<SavedAccountSession, "lastUsedAt">,
): Promise<void> {
  if (!hasTauriInternals() || isNativeMobileBuild) return;
  const vault = await loadSecureVault();
  const session = vault.sessions.find((item) => item.account.id === account.id);
  if (!session) return;
  session.account = { ...session.account, ...account };
  await persistSecureVault(vault);
}

export async function activateAccountSession(accountId: string): Promise<SavedAccountSession> {
  if (!hasTauriInternals() || isNativeMobileBuild) {
    throw new Error("Saved account switching is only available in the Misty desktop app.");
  }
  const vault = await loadSecureVault();
  const session = vault.sessions.find((item) => item.account.id === accountId);
  if (!session) throw new Error("That saved Misty session is no longer available.");

  session.account = { ...session.account, lastUsedAt: new Date().toISOString() };
  vault.activeAccountId = accountId;
  if (cachedToken !== session.token) accountSessionGeneration += 1;
  cachedToken = session.token;
  await persistSecureVault(vault);
  await syncManagedAiToken(session.token);
  return session.account;
}

export async function clearAccountAuthToken(): Promise<SavedAccountSession | null> {
  accountSessionGeneration += 1;
  cachedToken = null;
  if (!hasTauriInternals()) return null;
  await syncManagedAiToken("");

  if (isNativeMobileBuild) {
    writeTokenStoredMarker(false);
    try {
      await remove(desktopTokenService, desktopTokenUser);
    } catch (error) {
      recordRemoveError(error);
    }
    return null;
  }

  try {
    const vault = await loadSecureVault();
    const activeId = readActiveAccountId() || vault.activeAccountId;
    vault.sessions = vault.sessions.filter((item) => item.account.id !== activeId);
    const next =
      [...vault.sessions].sort((left, right) =>
        right.account.lastUsedAt.localeCompare(left.account.lastUsedAt),
      )[0] ?? null;
    vault.activeAccountId = next?.account.id ?? "";
    cachedToken = next?.token ?? null;
    await persistSecureVault(vault);
    await syncManagedAiToken(next?.token ?? "");
    return next?.account ?? null;
  } catch (error) {
    recordRemoveError(error);
    return null;
  }
}

/**
 * Signs out the active account without forgetting any saved session. The active
 * pointer and in-memory token are cleared so the app is logged out, but every
 * account stays listed so the sign-in chooser can offer them again (each is
 * re-validated, and re-login is required, only when it is next selected).
 */
export async function deactivateActiveAccount(): Promise<void> {
  accountSessionGeneration += 1;
  cachedToken = null;
  if (!hasTauriInternals()) return;
  await syncManagedAiToken("");

  if (isNativeMobileBuild) {
    // Mobile keeps a single raw token and no multi-account chooser, so signing
    // out clears it outright.
    writeTokenStoredMarker(false);
    try {
      await remove(desktopTokenService, desktopTokenUser);
    } catch (error) {
      recordRemoveError(error);
    }
    return;
  }

  try {
    const vault = await loadSecureVault();
    if (vault.sessions.length === 0) return;
    vault.activeAccountId = "";
    await persistSecureVault(vault);
  } catch (error) {
    recordRemoveError(error);
  }
}

/**
 * Removes a non-active saved session without changing the token currently used
 * by requests. A failed secure-store write leaves the session indexed and is
 * reported through diagnostics; the active identity remains unchanged.
 */
export async function removeSavedAccountSession(accountId: string): Promise<boolean> {
  if (!accountId || !hasTauriInternals() || isNativeMobileBuild) return false;
  try {
    const vault = await loadSecureVault();
    if (vault.activeAccountId === accountId || readActiveAccountId() === accountId) {
      throw new Error("The active Misty session cannot be removed as a background account.");
    }
    const sessions = vault.sessions.filter((item) => item.account.id !== accountId);
    if (sessions.length === vault.sessions.length) return true;
    vault.sessions = sessions;
    await persistSecureVault(vault);
    return true;
  } catch (error) {
    recordRemoveError(error);
    return false;
  }
}

async function loadSecureVault(): Promise<SecureAccountVault> {
  if (cachedVault) return cachedVault;
  let raw: string | null = null;
  try {
    raw = await retrieve(desktopTokenService, desktopTokenUser);
  } catch {
    // A missing Keychain item is a normal signed-out state.
  }

  const parsed = parseSecureVault(raw);
  cachedVault = parsed.vault;
  if (parsed.migrated && parsed.vault.sessions.length > 0) {
    await persistSecureVault(parsed.vault);
  }
  return parsed.vault;
}

function parseSecureVault(raw: string | null): { vault: SecureAccountVault; migrated: boolean } {
  if (raw) {
    try {
      const value = JSON.parse(raw) as Partial<SecureAccountVault>;
      if (value.version === 1 && Array.isArray(value.sessions)) {
        const sessions = value.sessions.filter(isSecureAccountSession);
        return {
          vault: { version: 1, activeAccountId: String(value.activeAccountId ?? ""), sessions },
          migrated: false,
        };
      }
    } catch {
      // Existing releases stored the active token directly; migrate it below.
    }
  }

  const legacyAccount = readLegacyAccount();
  if (raw && legacyAccount) {
    const account = { ...legacyAccount, lastUsedAt: new Date().toISOString() };
    return {
      vault: { version: 1, activeAccountId: account.id, sessions: [{ account, token: raw }] },
      migrated: true,
    };
  }
  return { vault: emptyVault(), migrated: false };
}

async function persistSecureVault(vault: SecureAccountVault): Promise<void> {
  cachedVault = vault;
  if (vault.sessions.length === 0) {
    try {
      await remove(desktopTokenService, desktopTokenUser);
    } catch {
      // Removing a missing item is equivalent to the desired state.
    }
    writeAccountIndex([], "");
    writeTokenStoredMarker(false);
    return;
  }
  await store(JSON.stringify(vault));
  writeAccountIndex(
    vault.sessions.map((item) => item.account),
    vault.activeAccountId,
  );
  writeTokenStoredMarker(true);
}

async function persistRawToken(token: string): Promise<void> {
  try {
    await store(token);
    writeTokenStoredMarker(true);
  } catch (error) {
    recordTokenDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not store Misty auth token in the device keystore.",
      detail: errorDetail(error),
    });
  }
  await syncManagedAiToken(token);
}

function selectActiveSession(vault: SecureAccountVault): SecureAccountSession | null {
  const preferredId = readActiveAccountId() || vault.activeAccountId;
  return (
    vault.sessions.find((item) => item.account.id === preferredId) ??
    [...vault.sessions].sort((left, right) =>
      right.account.lastUsedAt.localeCompare(left.account.lastUsedAt),
    )[0] ??
    null
  );
}

function writeAccountIndex(accounts: SavedAccountSession[], activeAccountId: string): void {
  try {
    if (accounts.length > 0) localStorage.setItem(accountIndexKey, JSON.stringify(accounts));
    else localStorage.removeItem(accountIndexKey);
    if (activeAccountId) localStorage.setItem(activeAccountKey, activeAccountId);
    else localStorage.removeItem(activeAccountKey);
  } catch {
    // Account display metadata is best-effort; tokens remain in the OS keystore.
  }
}

function readActiveAccountId(): string {
  try {
    return localStorage.getItem(activeAccountKey) ?? "";
  } catch {
    return "";
  }
}

function readLegacyAccount(): Omit<SavedAccountSession, "lastUsedAt"> | null {
  try {
    const raw = localStorage.getItem(legacyUserKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedAccountSession>;
    if (!value.id || !value.email) return null;
    return {
      id: value.id,
      name: value.name || value.email,
      username: value.username,
      email: value.email,
      accountCreatedAt: value.accountCreatedAt,
      currentPlan: value.currentPlan,
    };
  } catch {
    return null;
  }
}

function isSavedAccountSession(value: unknown): value is SavedAccountSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedAccountSession>;
  return Boolean(item.id && item.email && item.name && item.lastUsedAt);
}

function isSecureAccountSession(value: unknown): value is SecureAccountSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SecureAccountSession>;
  return (
    typeof item.token === "string" && item.token.length > 0 && isSavedAccountSession(item.account)
  );
}

function emptyVault(): SecureAccountVault {
  return { version: 1, activeAccountId: "", sessions: [] };
}

function recordRemoveError(error: unknown): void {
  recordTokenDebugEvent({
    level: "error",
    scope: "account-auth-token",
    message: "Could not remove the active Misty session from the device keystore.",
    detail: errorDetail(error),
  });
}

async function syncManagedAiToken(token: string): Promise<void> {
  if (!hasTauriInternals()) return;
  try {
    await invoke("automations_set_managed_ai_auth", { token });
  } catch {
    // Compatibility with native builds predating managed AI automation.
  }
}

function writeTokenStoredMarker(value: boolean): void {
  try {
    if (value) localStorage.setItem(tokenStoredMarkerKey, "1");
    else localStorage.removeItem(tokenStoredMarkerKey);
  } catch {
    // The marker is non-secret. If storage is unavailable, keep the in-memory cache only.
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

function recordTokenDebugEvent(event: {
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: string;
}): void {
  if (!tokenDebugEnabled()) return;
  void import("@/platform/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}

function tokenDebugEnabled(): boolean {
  return !isNativeMobileBuild && (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
}
