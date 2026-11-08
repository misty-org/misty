/**
 * The scope a window's account-owned data is kept under: the signed-in account's id, or `local`
 * while nobody is signed in. Workspace recovery, extensions and first-run setup are kept per
 * scope, so Misty works as a full browser with no account. The
 * native side knows the same id.
 */
export const localAccountScope = "local";

export function accountScopeFor(accountId: string | null | undefined): string {
  return accountId?.trim() || localAccountScope;
}

export function isLocalAccountScope(scope: string): boolean {
  return scope === localAccountScope;
}
