import { forgetAccountCookies, restoreAccountCookies } from "@/api/client/cookie_session";
import { clearApiCache } from "@/api/cache/api_cache";
import { configureApiSession } from "@/api/client/session";
import { resolveApiBase } from "@/api/deployment/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { activeVaultAccountId, vaultAccountId, type SavedAccountSession } from "./account_vault";
import { errorDetail, recordRemoveError, recordTokenDebugEvent } from "./auth_token_debug";
import {
  loadSecureVault,
  persistSecureVault,
  readActiveAccountId,
  writeAccountIndex,
  writeTokenStoredMarker,
} from "./vault_keystore";
import { SavedAccountSessionUnavailableError } from "./session_errors";
import {
  listSavedAccountSessions,
  readActiveSavedAccountSession,
  selectActiveSession,
  updateSavedAccountSession,
} from "./saved_account_sessions";
export { listSavedAccountSessions, readActiveSavedAccountSession, updateSavedAccountSession };
let cachedToken: string | null | undefined;
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
  if (!account?.id) return;
  try {
    const vault = await loadSecureVault();
    const saved: SavedAccountSession = {
      ...account,
      lastUsedAt: new Date().toISOString(),
    };
    const sessions = vault.sessions.filter((item) => item.account.id !== saved.id);
    sessions.push({
      account: saved,
      token,
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
      message: "Could not store Misty account sessions in this computer's keystore.",
      detail: errorDetail(error),
    });
    await syncManagedAiToken(token);
  }
}
export async function readAccountAuthToken(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
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
      message: "Could not read Misty account sessions from this computer's keystore.",
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
  const session = vault.sessions.find((item) => item.account.id === accountId);
  if (!session) {
    const activeAccountId = vault.sessions.some((item) => item.account.id === readActiveAccountId())
      ? readActiveAccountId()
      : activeVaultAccountId(vault);
    writeAccountIndex(
      vault.sessions.map((item) => item.account),
      activeAccountId,
    );
    throw new SavedAccountSessionUnavailableError(
      "That saved Misty session is no longer available.",
    );
  }

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
    vault.sessions = vault.sessions.filter((item) => item.account.id !== activeId);
    const next =
      [...vault.sessions].sort((left, right) =>
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
  isSignedOut: () => hasTauriInternals() && cachedToken === null,
  readAccountId: readActiveAccountId,
  readGeneration: readAccountSessionGeneration,
  readToken: async () => {
    await readAccountAuthToken();
    return null;
  },
});
