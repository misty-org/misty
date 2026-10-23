import { forgetAccountCookies, restoreAccountCookies } from "@/api/client/cookie-session";
import { clearApiCache } from "@/api/cache/api-cache";
import { configureApiSession } from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { store } from "@impierce/tauri-plugin-keystore";
import {
  activeHostedAccountId,
  hostedScope,
  hostedSessions,
  isHostedSession,
  vaultAccountId,
  type SavedAccountSession,
} from "./accountVault";
import { errorDetail, recordRemoveError, recordTokenDebugEvent } from "./authTokenDebug";
import {
  loadSecureVault,
  persistSecureVault,
  readActiveAccountId,
  writeAccountIndex,
  writeTokenStoredMarker,
} from "./vaultKeystore";
import { SavedAccountSessionUnavailableError } from "../sessionErrors";
import {
  listSavedAccountSessions,
  readActiveSavedAccountSession,
  selectActiveSession,
  updateSavedAccountSession,
} from "./savedAccountSessions";
export type { SavedAccountSession } from "./accountVault";
export { listSavedAccountSessions, readActiveSavedAccountSession, updateSavedAccountSession };
let cachedToken: string | null | undefined;
// A cold start can fan out several authenticated requests before the first
// secure-store read finishes. Share one retrieval across concurrent callers.
let tokenReadPromise: Promise<string | null> | undefined;
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
  if (!account?.id) {
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
      (item) => !isHostedSession(item) || item.account.id !== saved.id,
    );
    sessions.push({
      account: saved,
      token,
      deploymentScope: hostedScope,
    });
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
    {
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
export async function activateAccountSession(accountId: string): Promise<SavedAccountSession> {
  if (!hasTauriInternals()) {
    throw new Error("Saved account switching is only available in the Misty desktop app.");
  }
  const vault = await loadSecureVault();
  const session = vault.sessions.find(
    (item) => isHostedSession(item) && item.account.id === accountId,
  );
  if (!session) {
    const activeAccountId = hostedSessions(vault).some(
      (item) => item.account.id === readActiveAccountId(),
    )
      ? readActiveAccountId()
      : activeHostedAccountId(vault);
    writeAccountIndex(
      hostedSessions(vault).map((item) => item.account),
      activeAccountId,
    );
    throw new SavedAccountSessionUnavailableError(
      "That saved Misty session is no longer available.",
    );
  }

  // Restore first: an unavailable cookie record must not activate a handle
  // whose requests would still use the previous account's cookies.
  await syncManagedAiToken(session.token);
  session.account = {
    ...session.account,
    lastUsedAt: new Date().toISOString(),
  };
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
  try {
    const vault = await loadSecureVault();
    const activeId = readActiveAccountId();
    if (activeId) await clearApiCache(activeId);
    if (activeId) await forgetAccountCookies(await resolveApiBase(), activeId);
    vault.sessions = vault.sessions.filter(
      (item) => !isHostedSession(item) || item.account.id !== activeId,
    );
    const next =
      hostedSessions(vault).sort((left, right) =>
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
  if (!accountId || !hasTauriInternals()) return false;
  try {
    const vault = await loadSecureVault();
    if (
      vault.activeAccountId === vaultAccountId(accountId) ||
      readActiveAccountId() === accountId
    ) {
      throw new Error("The active Misty session cannot be removed as a background account.");
    }
    await clearApiCache(accountId);
    await forgetAccountCookies(await resolveApiBase(), accountId);
    const sessions = vault.sessions.filter(
      (item) => !isHostedSession(item) || item.account.id !== accountId,
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
configureApiSession({
  isTransitioning: isAccountSessionTransitioning,
  // Desktop only: the browser's own cookies decide there. Unknown until the
  // keystore has been read, so startup requests still go out and restore it.
  isSignedOut: () => hasTauriInternals() && cachedToken === null,
  readAccountId: readActiveAccountId,
  readGeneration: readAccountSessionGeneration,
  readToken: async () => {
    await readAccountAuthToken();
    return null;
  },
});
