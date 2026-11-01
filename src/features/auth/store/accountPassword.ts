import { accountApi, isAccountUnauthorizedError } from "@/api/account/api";
import {
  deriveLoginCredential,
  isCredentialEmail,
  markCredentialAccount,
  passwordProblem,
} from "./accountCredential";
import { clearPasswordPending } from "./pendingPassword";
import { forgetPasswordReset, passwordResetToken } from "./passwordReset";

const REUSED = "Choose a password you have not used before.";

/**
 * Changes the password of a signed-in account. The server is sent values
 * derived on the device. An account this device has not seen sign in with a
 * credential may still hold its password as typed, recognised by the current
 * password being refused as a derived credential; one that has is never sent
 * its password in plain form.
 */
export async function accountChangePassword(
  email: string,
  current: string,
  next: string,
): Promise<void> {
  const nextCredential = await deriveLoginCredential(email, next);
  if (!nextCredential) throw new Error("Change your password in the Misty desktop app.");
  // The same password cannot be a new one: an older account's is in the server's hands in plain form.
  if (current === next) throw new Error(REUSED);
  const currentCredential = await deriveLoginCredential(email, current);
  if (currentCredential === nextCredential) throw new Error(REUSED);
  try {
    await accountApi.changePassword(currentCredential ?? current, nextCredential);
  } catch (error) {
    if (!isAccountUnauthorizedError(error) || isCredentialEmail(email)) throw error;
    await accountApi.changePassword(current, nextCredential);
  }
}

/**
 * The password of an account a setup key signed in: its first, or a new one in place of a
 * forgotten one. It is derived on the device exactly as at registration (`accountRegister`): the
 * same rules, the same login credential, and the same email kept for the vault key, so sync
 * opens like any other account's. The sign-in's reset token stands in for the current password
 * (`PUT /me/password`). Without one (the app restarted since), the server takes an empty current
 * password only while the account has none; an account that turns out to have one keeps it.
 */
export async function accountSetFirstPassword(
  accountId: string,
  email: string,
  password: string,
): Promise<"set" | "existing"> {
  const credential = await deriveLoginCredential(email, password);
  if (!credential) throw new Error("Choose your password in the Misty desktop app.");
  const problem = await passwordProblem(email, password);
  if (problem) throw new Error(problem);
  const resetToken = passwordResetToken(accountId);
  try {
    await accountApi.changePassword("", credential, resetToken);
  } catch (error) {
    if (!isAccountUnauthorizedError(error)) throw error;
    if (resetToken) {
      forgetPasswordReset(accountId);
      throw new Error(
        "This sign-in link can no longer set a password. Ask for a new link, or sign in with your password.",
      );
    }
    clearPasswordPending(accountId);
    return "existing";
  }
  forgetPasswordReset(accountId);
  markCredentialAccount(accountId, email);
  clearPasswordPending(accountId);
  return "set";
}
