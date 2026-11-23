const tokens = new Map<string, string>();

export function rememberPasswordReset(accountId: string, token: string | undefined): void {
  if (token) tokens.set(accountId, token);
  else tokens.delete(accountId);
}

export function passwordResetToken(accountId: string): string | undefined {
  return tokens.get(accountId);
}

export function forgetPasswordReset(accountId: string): void {
  tokens.delete(accountId);
}
