import { clearApiCache } from "@/api/cache/api-cache";
import { captureAccountCookies, forgetAccountCookies } from "@/api/client/cookie-session";
import { accountApi, AccountApiError, isAccountUnauthorizedError } from "../api/api";
import type {
  AccountAuthUser,
  AccountMeResponse,
  LoginResponse,
  SetupKeyResponse,
} from "../api/accountTypes";
import { ConfirmEmailSent } from "./confirmEmailSent";
import { rememberPasswordReset } from "./passwordReset";
import { passwordProblem } from "./passwordRules";
import {
  beginGoogleSignInCodeWait,
  deliveredGoogleSignInCode,
  endGoogleSignInCodeWait,
  waitForGoogleSignInCode,
} from "../google/googleSignInCode";
import { saveAccountAuthToken } from "./useAuthTokenStore";

export { isAccountUnauthorizedError } from "../api/api";

function authenticatedUser(data: LoginResponse, operation: string): AccountAuthUser {
  const id = data.user_id ?? data.id;
  if (!id) throw new AccountApiError(`${operation} response did not include a user id.`);
  return {
    id,
    username: data.username,
    email: data.email,
    provider: data.provider,
  };
}

async function persistLogin(data: LoginResponse, operation: string): Promise<AccountAuthUser> {
  const user = authenticatedUser(data, operation);
  await captureAccountCookies(await accountApi.resolveBase(), user.id);
  await saveAccountAuthToken(`cookie-session:${user.id}`, user);
  return user;
}

export async function accountSignIn(email: string, password: string): Promise<AccountAuthUser> {
  return persistLogin(await accountApi.signIn(email, password), "Sign-in");
}

/**
 * Signs in with a setup key from a sign-in link, which the server takes once in place of a
 * password (`POST /setup-keys/redeem`, answered like `/login`). The answer's reset token lets the
 * wizard choose a new password: that is how a forgotten password is reset (`passwordReset.ts`).
 */
export async function accountRedeemSetupKey(setupKey: string): Promise<AccountAuthUser> {
  return accountFinishSetupKey(await accountApi.redeemSetupKey(setupKey.trim()));
}

/** Takes the answer to a setup key, redeemed here or just before moving to its server. */
export async function accountFinishSetupKey(data: SetupKeyResponse): Promise<AccountAuthUser> {
  const user = await persistLogin(data, "Setup key");
  rememberPasswordReset(user.id, data.password_reset_token);
  return user;
}

export async function accountGoogleSignIn(
  launch: (url: string) => Promise<void>,
  signal: AbortSignal,
  onAwaitingCode?: () => void,
): Promise<AccountAuthUser> {
  const result = await googleFlow(launch, signal, false, onAwaitingCode);
  if ("reauthentication_token" in result) throw new Error("Unexpected Google sign-in response.");
  return persistLogin(result, "Google sign-in");
}

export async function accountGoogleReauthenticate(
  launch: (url: string) => Promise<void>,
  signal: AbortSignal,
  onAwaitingCode?: () => void,
): Promise<string> {
  const result = await googleFlow(launch, signal, true, onAwaitingCode);
  if (!("reauthentication_token" in result))
    throw new Error("Unexpected Google reauthentication response.");
  return result.reauthentication_token;
}

async function googleFlow(
  launch: (url: string) => Promise<void>,
  signal: AbortSignal,
  reauthenticate: boolean,
  onAwaitingCode?: () => void,
): Promise<LoginResponse | { reauthentication_token: string }> {
  const flow = await accountApi.beginGoogle(reauthenticate, signal);
  signal.throwIfAborted();
  // The browser hands back a one-time code (by misty:// link or typed); the
  // server releases the session only with it. See googleSignInCode.ts.
  beginGoogleSignInCodeWait();
  try {
    await launch(flow.url);
    const deadline = Date.now() + Math.min(flow.expires_in, 600) * 1000;
    let announced = false;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const code = deliveredGoogleSignInCode();
      const result = await accountApi.completeGoogle(flow.flow_token, signal, code || undefined);
      signal.throwIfAborted();
      if (!("status" in result)) return result;
      if (result.status === "confirm" && !announced) {
        announced = true;
        onAwaitingCode?.();
      }
      await waitForGoogleSignInCode(2500, signal);
    }
    throw new Error("Google sign-in expired. Please try again.");
  } finally {
    endGoogleSignInCodeWait();
  }
}

/** Ends the account's server session and forgets its saved tokens, so the
 * next use of this account requires its password. Local tokens are forgotten
 * even when the server cannot be reached; that failure is still reported. */
export async function accountLogout(accountId: string): Promise<void> {
  try {
    await accountApi.logout();
  } finally {
    if (accountId) {
      await clearApiCache(accountId);
      await forgetAccountCookies(await accountApi.resolveBase(), accountId);
    }
  }
}

export async function accountRegister(
  username: string,
  email: string,
  password: string,
): Promise<AccountAuthUser> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const answer = await accountApi.register({ username, email, password });
  if ("status" in answer) throw new ConfirmEmailSent();
  return persistLogin(answer, "Registration");
}

const confirmationCheckMs = 6000;

function confirmationCheckDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, confirmationCheckMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Resolves once the link in a sign-up's confirmation email has made its account, so the form
 * can sign in. A refused password ends the wait: the sign-up expired or was replaced. Anything
 * else, such as being offline, only delays the next check.
 */
export async function accountWaitForConfirmation(
  email: string,
  password: string,
  signal: AbortSignal,
): Promise<void> {
  for (;;) {
    await confirmationCheckDelay(signal);
    try {
      const { status } = await accountApi.confirmationStatus(email, password);
      if (status === "confirmed") return;
    } catch (error) {
      if (isAccountUnauthorizedError(error)) throw error;
    }
  }
}

export function accountFetchMe(): Promise<AccountMeResponse> {
  return accountApi.me();
}

export function accountFetchAvatar(): Promise<Blob> {
  return accountApi.avatar();
}
