export const localAccountScope = "local";

export function accountScopeFor(accountId: string | null | undefined): string {
  return accountId?.trim() || localAccountScope;
}

export function isLocalAccountScope(scope: string): boolean {
  return scope === localAccountScope;
}
