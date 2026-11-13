import { activateAccountSession, listSavedAccountSessions } from "./useAuthTokenStore";

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
