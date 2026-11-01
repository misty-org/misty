/**
 * The reset token a setup key's sign-in returns (`password_reset_token`): for a short while it
 * lets that sign-in choose a new password without the old one. The server sends no email, so a
 * sign-in link is how a forgotten password is reset. Held in memory only, per account, and
 * never logged; it is gone once used or when the app quits.
 */
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
