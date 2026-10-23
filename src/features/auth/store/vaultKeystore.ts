import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { remove, retrieve, store } from "@impierce/tauri-plugin-keystore";
import {
  activeHostedAccountId,
  hostedSessions,
  parseSecureVault,
  type SavedAccountSession,
  type SecureAccountVault,
} from "./accountVault";

/** The device keystore that holds the account vault, and the display index beside it. */
const desktopTokenService = "com.impierce.identity-wallet";
const desktopTokenUser = "tester";
const tokenStoredMarkerKey = "misty:account-auth-token:file-present";
export const accountIndexKey = "misty:account-sessions";
const activeAccountKey = "misty:active-account-id";
let cachedVault: SecureAccountVault | undefined;
let vaultReadPromise: Promise<SecureAccountVault> | undefined;
// The most recent payload written to the native credential store. The app persists the vault on nearly every
// auth state change (login, /me refresh, effect re-runs), so we skip redundant
// writes whose serialized content is identical to what is already stored.
let lastPersistedPayload: string | undefined;

export async function loadSecureVault(): Promise<SecureAccountVault> {
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
export async function persistSecureVault(vault: SecureAccountVault): Promise<void> {
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
    hostedSessions(vault).map((item) => item.account),
    activeHostedAccountId(vault),
  );
  writeTokenStoredMarker(true);
}
export function writeAccountIndex(accounts: SavedAccountSession[], activeAccountId: string): void {
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
export function readActiveAccountId(): string {
  try {
    return readDeploymentStorageItem(activeAccountKey) ?? "";
  } catch {
    return "";
  }
}

export function writeTokenStoredMarker(value: boolean): void {
  try {
    if (value) localStorage.setItem(tokenStoredMarkerKey, "1");
    else localStorage.removeItem(tokenStoredMarkerKey);
  } catch {
    // The marker is non-secret. If storage is unavailable, keep the in-memory cache only.
  }
}
