import { SavedAccountSessionUnavailableError } from "../sessionErrors";
import { restoreAccountCookies, forgetAccountCookies } from "@/api/client/cookie-session";
import { resolveApiBase, resolveHostedApiBase } from "@/api/deployment/api";
import { configureApiSession } from "@/api/client/session";
import {
  deploymentStorageKey,
  readDeploymentScope,
  readDeploymentStorageItem,
} from "@/api/deployment/api";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { remove, retrieve, store } from "@impierce/tauri-plugin-keystore";
import type {
  SavedAccountSession,
  SecureAccountSession,
  SecureAccountVault,
} from "../model/stores/account/interfaces/useAuthTokenStore";
export type {
  SavedAccountSession,
  SecureAccountSession,
  SecureAccountVault,
} from "../model/stores/account/interfaces/useAuthTokenStore";

const desktopTokenService = "com.impierce.identity-wallet";
const desktopTokenUser = "tester";
const tokenStoredMarkerKey = "misty:account-auth-token:file-present";
const accountIndexKey = "misty:account-sessions";
const activeAccountKey = "misty:active-account-id";
const legacyUserKey = "misty_user";

let cachedToken: string | null | undefined;
let cachedVault: SecureAccountVault | undefined;
let vaultReadPromise: Promise<SecureAccountVault> | undefined;
// A cold start can fan out several authenticated requests before the first
// secure-store read finishes. On iOS each concurrent read can present its own
// system authentication sheet, so every caller must share one retrieval.
let tokenReadPromise: Promise<string | null> | undefined;
// The most recent payload written to the native credential store. The app persists the vault on nearly every
// auth state change (login, /me refresh, effect re-runs), so we skip redundant
// writes whose serialized content is identical to what is already stored.
let lastPersistedPayload: string | undefined;
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
    const sessions = vault.sessions.filter(
      (item) => !isCurrentDeploymentSession(item) || item.account.id !== saved.id,
    );
    sessions.push({ account: saved, token, deploymentScope: readDeploymentScope() });
    await persistSecureVault({
      version: 1,
      activeAccountId: vaultAccountId(saved.id),
      sessions,
    });
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
  // The handle can be loaded before the native cookie restore finishes. Every
  // caller must wait for that restore before issuing authenticated requests.
  if (tokenReadPromise) return tokenReadPromise;
  if (cachedToken !== undefined) return cachedToken;
  tokenReadPromise = loadAccountAuthToken();
  try {
    return await tokenReadPromise;
  } finally {
    tokenReadPromise = undefined;
  }
}

async function loadAccountAuthToken(): Promise<string | null> {
  const generation = accountSessionGeneration;
  try {
    if (isNativeMobileBuild) {
      const token = await retrieve(desktopTokenService, desktopTokenUser);
      if (generation !== accountSessionGeneration) return cachedToken ?? null;
      if (cachedToken === undefined) cachedToken = token;
    } else {
      const vault = await loadSecureVault();
      if (generation !== accountSessionGeneration) return cachedToken ?? null;
      const active = selectActiveSession(vault);
      if (cachedToken === undefined) cachedToken = active?.token ?? null;
      if (active && vault.activeAccountId !== vaultAccountId(active.account.id)) {
        vault.activeAccountId = vaultAccountId(active.account.id);
        await persistSecureVault(vault);
      }
    }
    writeTokenStoredMarker(Boolean(cachedToken));
    await syncManagedAiToken(cachedToken ?? "");
  } catch (error) {
    if (generation === accountSessionGeneration) cachedToken = null;
    writeTokenStoredMarker(false);
    recordTokenDebugEvent({
      level: "error",
      scope: "account-auth-token",
      message: "Could not read Misty account sessions from the device keystore.",
      detail: errorDetail(error),
    });
  }
  return cachedToken ?? null;
}

/** Reads a preserved Misty Hosted session specifically for entitlement minting.
 * It never changes the active deployment or exposes that token to the custom
 * server request path. */
export async function readHostedAccountAuthToken(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  if (readDeploymentScope() === "hosted") return readAccountAuthToken();
  if (isNativeMobileBuild) return null;
  const vault = await loadSecureVault();
  const hosted = vault.sessions
    .filter((session) => sessionDeploymentScope(session) === "hosted")
    .sort((left, right) => right.account.lastUsedAt.localeCompare(left.account.lastUsedAt))[0];
  if (!hosted) return null;
  if (!(await restoreAccountCookies(resolveHostedApiBase(), hosted.account.id))) return null;
  return hosted.token;
}

export function listSavedAccountSessions(): SavedAccountSession[] {
  try {
    const raw = readDeploymentStorageItem(accountIndexKey);
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
  const session = vault.sessions.find(
    (item) => isCurrentDeploymentSession(item) && item.account.id === account.id,
  );
  if (!session) return;
  session.account = { ...session.account, ...account };
  await persistSecureVault(vault);
}

export async function activateAccountSession(accountId: string): Promise<SavedAccountSession> {
  if (!hasTauriInternals() || isNativeMobileBuild) {
    throw new Error("Saved account switching is only available in the Misty desktop app.");
  }
  const vault = await loadSecureVault();
  const session = vault.sessions.find(
    (item) => isCurrentDeploymentSession(item) && item.account.id === accountId,
  );
  if (!session) {
    const activeAccountId = currentDeploymentSessions(vault).some(
      (item) => item.account.id === readActiveAccountId(),
    )
      ? readActiveAccountId()
      : activeAccountIdForCurrentDeployment(vault);
    writeAccountIndex(
      currentDeploymentSessions(vault).map((item) => item.account),
      activeAccountId,
    );
    throw new SavedAccountSessionUnavailableError(
      "That saved Misty session is no longer available.",
    );
  }

  // Restore first: an unavailable cookie record must not activate a handle
  // whose requests would still use the previous account's cookies.
  await syncManagedAiToken(session.token);
  session.account = { ...session.account, lastUsedAt: new Date().toISOString() };
  vault.activeAccountId = vaultAccountId(accountId);
  if (cachedToken !== session.token) accountSessionGeneration += 1;
  cachedToken = session.token;
  await persistSecureVault(vault);
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
    const activeId = readActiveAccountId();
    if (activeId) await forgetAccountCookies(await resolveApiBase(), activeId);
    vault.sessions = vault.sessions.filter(
      (item) => !isCurrentDeploymentSession(item) || item.account.id !== activeId,
    );
    const next =
      currentDeploymentSessions(vault).sort((left, right) =>
        right.account.lastUsedAt.localeCompare(left.account.lastUsedAt),
      )[0] ?? null;
    vault.activeAccountId = next ? vaultAccountId(next.account.id) : "";
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
    if (
      vault.activeAccountId === vaultAccountId(accountId) ||
      readActiveAccountId() === accountId
    ) {
      throw new Error("The active Misty session cannot be removed as a background account.");
    }
    await forgetAccountCookies(await resolveApiBase(), accountId);
    const sessions = vault.sessions.filter(
      (item) => !isCurrentDeploymentSession(item) || item.account.id !== accountId,
    );
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
  if (vaultReadPromise) return vaultReadPromise;
  vaultReadPromise = readSecureVault().finally(() => {
    vaultReadPromise = undefined;
  });
  return vaultReadPromise;
}

async function readSecureVault(): Promise<SecureAccountVault> {
  let raw: string | null = null;
  try {
    raw = await retrieve(desktopTokenService, desktopTokenUser);
  } catch {
    // A missing credential file is a normal signed-out state.
  }

  const parsed = parseSecureVault(raw);
  cachedVault = parsed.vault;
  if (parsed.migrated && parsed.vault.sessions.length > 0) {
    await persistSecureVault(parsed.vault);
  } else if (parsed.vault.sessions.length > 0) {
    // Record what the keystore already holds so an unchanged re-persist on the
    // common cold-start path is skipped.
    lastPersistedPayload = JSON.stringify(parsed.vault);
  }
  return parsed.vault;
}

function parseSecureVault(raw: string | null): { vault: SecureAccountVault; migrated: boolean } {
  if (raw) {
    try {
      const value = JSON.parse(raw) as Partial<SecureAccountVault>;
      if (value.version === 1 && Array.isArray(value.sessions)) {
        const sessions = value.sessions
          .filter(isSecureAccountSession)
          .filter((session) => session.token.startsWith("cookie-session:"));
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
  if (raw?.startsWith("cookie-session:") && legacyAccount) {
    const account = { ...legacyAccount, lastUsedAt: new Date().toISOString() };
    return {
      vault: {
        version: 1,
        activeAccountId: `hosted:${account.id}`,
        sessions: [{ account, token: raw, deploymentScope: "hosted" }],
      },
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
    lastPersistedPayload = undefined;
    writeAccountIndex([], "");
    writeTokenStoredMarker(false);
    return;
  }
  const payload = JSON.stringify(vault);
  // Avoid redundant atomic file writes when the account metadata is unchanged.
  if (payload !== lastPersistedPayload) {
    await store(payload);
    lastPersistedPayload = payload;
  }
  writeAccountIndex(
    currentDeploymentSessions(vault).map((item) => item.account),
    activeAccountIdForCurrentDeployment(vault),
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
  const preferredId = readActiveAccountId() || activeAccountIdForCurrentDeployment(vault);
  const sessions = currentDeploymentSessions(vault);
  if (!preferredId && vault.activeAccountId === "") return null;
  return (
    sessions.find((item) => item.account.id === preferredId) ??
    sessions.sort((left, right) =>
      right.account.lastUsedAt.localeCompare(left.account.lastUsedAt),
    )[0] ??
    null
  );
}

function writeAccountIndex(accounts: SavedAccountSession[], activeAccountId: string): void {
  try {
    const indexKey = deploymentStorageKey(accountIndexKey);
    const activeKey = deploymentStorageKey(activeAccountKey);
    if (accounts.length > 0) localStorage.setItem(indexKey, JSON.stringify(accounts));
    else localStorage.removeItem(indexKey);
    if (activeAccountId) localStorage.setItem(activeKey, activeAccountId);
    else localStorage.removeItem(activeKey);
  } catch {
    // Account display metadata is best-effort; tokens remain in the native credential store.
  }
}

function readActiveAccountId(): string {
  try {
    return readDeploymentStorageItem(activeAccountKey) ?? "";
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
  return Boolean(
    typeof item.token === "string" &&
    item.token.length > 0 &&
    isSavedAccountSession(item.account) &&
    (item.deploymentScope === undefined || typeof item.deploymentScope === "string"),
  );
}

function sessionDeploymentScope(session: SecureAccountSession): string {
  return session.deploymentScope || "hosted";
}

function isCurrentDeploymentSession(session: SecureAccountSession): boolean {
  return sessionDeploymentScope(session) === readDeploymentScope();
}

function currentDeploymentSessions(vault: SecureAccountVault): SecureAccountSession[] {
  return vault.sessions.filter(isCurrentDeploymentSession);
}

function vaultAccountId(accountId: string): string {
  return `${readDeploymentScope()}:${accountId}`;
}

function activeAccountIdForCurrentDeployment(vault: SecureAccountVault): string {
  const prefix = `${readDeploymentScope()}:`;
  if (vault.activeAccountId.startsWith(prefix)) return vault.activeAccountId.slice(prefix.length);
  // Vaults written before deployment namespacing contain a bare Hosted id.
  if (readDeploymentScope() === "hosted" && !vault.activeAccountId.includes(":")) {
    return vault.activeAccountId;
  }
  return "";
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

// The saved "token" is now a non-secret account handle. Actual JWT cookies
// are persisted and restored entirely by native code.
async function syncManagedAiToken(token: string): Promise<void> {
  if (!hasTauriInternals()) return;
  const accountId = token.startsWith("cookie-session:")
    ? token.slice("cookie-session:".length)
    : null;
  const restored = await restoreAccountCookies(await resolveApiBase(), accountId);
  if (accountId && !restored) throw new SavedAccountSessionUnavailableError();
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
  void import("@/shared/platform/clientDebug").then(({ recordClientDebugEvent }) => {
    recordClientDebugEvent(event);
  });
}

function tokenDebugEnabled(): boolean {
  return !isNativeMobileBuild && (import.meta.env.DEV || import.meta.env.VITE_MISTY_DEBUG === "1");
}

configureApiSession({
  isTransitioning: isAccountSessionTransitioning,
  // Desktop only: the browser's own cookies decide there. Unknown until the
  // keystore has been read, so startup requests still go out and restore it.
  isSignedOut: () => hasTauriInternals() && !isNativeMobileBuild && cachedToken === null,
  readGeneration: readAccountSessionGeneration,
  readToken: async () => {
    await readAccountAuthToken();
    return null;
  },
});
