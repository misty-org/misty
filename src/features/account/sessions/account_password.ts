import { accountApi, isAccountUnauthorizedError } from "../api/api";
import { forgetPasswordReset, passwordResetToken } from "./password_reset";
import { passwordProblem } from "./password_rules";

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
