import { readDeploymentStorageItem } from "@/api/deployment/api";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  activeHostedAccountId,
  hostedSessions,
  isPresent,
  isHostedSession,
  savedAccountSession,
  type SavedAccountSession,
  type SecureAccountSession,
  type SecureAccountVault,
} from "./accountVault";
import {
  accountIndexKey,
  loadSecureVault,
  persistSecureVault,
  readActiveAccountId,
} from "./vaultKeystore";

// The accounts saved on this device, as the account switcher lists them (useAuthTokenStore.ts).

export function listSavedAccountSessions(): SavedAccountSession[] {
  try {
    const raw = readDeploymentStorageItem(accountIndexKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    const activeId = readActiveAccountId();
    return parsed
      .map(savedAccountSession)
      .filter(isPresent)
      .sort((left, right) => {
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
  if (!hasTauriInternals()) return;
  const vault = await loadSecureVault();
  const session = vault.sessions.find(
    (item) => isHostedSession(item) && item.account.id === account.id,
  );
  if (!session) return;
  session.account = {
    ...session.account,
    ...account,
  };
  await persistSecureVault(vault);
}
export function selectActiveSession(vault: SecureAccountVault): SecureAccountSession | null {
  const preferredId = readActiveAccountId() || activeHostedAccountId(vault);
  const sessions = hostedSessions(vault);
  if (!preferredId && vault.activeAccountId === "") return null;
  return (
    sessions.find((item) => item.account.id === preferredId) ??
    sessions.sort((left, right) =>
      right.account.lastUsedAt.localeCompare(left.account.lastUsedAt),
    )[0] ??
    null
  );
}
