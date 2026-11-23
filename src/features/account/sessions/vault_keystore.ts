import { deploymentStorageKey, readDeploymentStorageItem } from "@/api/deployment/api";
import { remove, retrieve, store } from "@impierce/tauri-plugin-keystore";
import {
  activeVaultAccountId,
  parseSecureVault,
  type SavedAccountSession,
  type SecureAccountVault,
} from "./account_vault";

const desktopTokenService = "com.impierce.identity-wallet";
const desktopTokenUser = "tester";
const tokenStoredMarkerKey = "misty:account-auth-token:file-present";
export const accountIndexKey = "misty:account-sessions";
const activeAccountKey = "misty:active-account-id";
let cachedVault: SecureAccountVault | undefined;
let vaultReadPromise: Promise<SecureAccountVault> | undefined;
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
  } catch {}
  const vault = parseSecureVault(raw);
  cachedVault = vault;
  if (vault.sessions.length > 0) lastPersistedPayload = JSON.stringify(vault);
  return vault;
}
export async function persistSecureVault(vault: SecureAccountVault): Promise<void> {
  cachedVault = vault;
  if (vault.sessions.length === 0) {
    try {
      await remove(desktopTokenService, desktopTokenUser);
    } catch {}
    lastPersistedPayload = undefined;
    writeAccountIndex([], "");
    writeTokenStoredMarker(false);
    return;
  }
  const payload = JSON.stringify(vault);
  if (payload !== lastPersistedPayload) {
    await store(payload);
    lastPersistedPayload = payload;
  }
  writeAccountIndex(
    vault.sessions.map((item) => item.account),
    activeVaultAccountId(vault),
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
  } catch {}
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
  } catch {}
}
