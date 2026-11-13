import { accountApi, isAccountUnauthorizedError } from "../api/api";
import { forgetPasswordReset, passwordResetToken } from "./passwordReset";
import { passwordProblem } from "./passwordRules";

/**
 * The password of an account a setup key signed in: its first, or a new one in place of a
 * forgotten one. The sign-in's reset token stands in for the current password
 * (`PUT /me/password`). Without one (the app restarted since), the server takes an empty current
 * password only while the account has none; an account that turns out to have one keeps it.
 */
export async function accountSetFirstPassword(
  accountId: string,
  password: string,
): Promise<"set" | "existing"> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const resetToken = passwordResetToken(accountId);
  try {
    await accountApi.changePassword("", password, resetToken);
  } catch (error) {
    if (!isAccountUnauthorizedError(error)) throw error;
    if (resetToken) {
      forgetPasswordReset(accountId);
      throw new Error(
        "This sign-in link can no longer set a password. Ask for a new link, or sign in with your password.",
      );
    }
    return "existing";
  }
  forgetPasswordReset(accountId);
  return "set";
}
