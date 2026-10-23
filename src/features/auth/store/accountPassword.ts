import { accountApi, isAccountUnauthorizedError } from "@/api/account/api";
import { deriveLoginCredential, isCredentialEmail } from "./accountCredential";

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
