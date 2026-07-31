import {
  activateAccountSession,
  listSavedAccountSessions,
} from "@/stores/account/useAuthTokenStore";

export async function restoreSavedSession(accountId: string): Promise<void> {
  if (!accountId) return;
  if (!listSavedAccountSessions().some((account) => account.id === accountId)) return;
  await activateAccountSession(accountId);
}

export async function tryRestoreSavedSession(accountId: string): Promise<boolean> {
  if (!accountId) return false;
  if (!listSavedAccountSessions().some((account) => account.id === accountId)) return false;
  try {
    await activateAccountSession(accountId);
    return true;
  } catch {
    return false;
  }
}
