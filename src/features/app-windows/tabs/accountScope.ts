/**
 * The scope a window's account-owned data is kept under: the signed-in account's id. `local` is
 * where earlier versions, which worked signed out, kept windows and tabs; the first sign-in takes
 * them over, and signing out leaves it empty. The native side knows the same id.
 */
export const localAccountScope = "local";

export function accountScopeFor(accountId: string | null | undefined): string {
  return accountId?.trim() || localAccountScope;
}

export function isLocalAccountScope(scope: string): boolean {
  return scope === localAccountScope;
}
