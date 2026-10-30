import { clearApiCache } from "@/api/cache/api-cache";
import { captureAccountCookies, forgetAccountCookies } from "@/api/client/cookie-session";
import {
  accountApi,
  AccountApiError,
  configureAccountApi,
  isAccountUnauthorizedError,
} from "@/api/account/api";
import {
  deriveLoginCredential,
  isCredentialEmail,
  markCredentialAccount,
  passwordProblem,
  unmarkCredentialAccount,
} from "./accountCredential";
import type { AccountAuthUser, AccountMeResponse, LoginResponse } from "@/api/account/types";
import { configureTelemetryPreferencesSync } from "@/telemetry/lifecycle";
import { analytics } from "@/telemetry/client";
import {
  beginGoogleSignInCodeWait,
  deliveredGoogleSignInCode,
  endGoogleSignInCodeWait,
  waitForGoogleSignInCode,
} from "../googleSignInCode";
import { saveAccountAuthToken } from "./useAuthTokenStore";

export type { AccountAuthUser, AccountMeResponse } from "@/api/account/types";
export { isAccountUnauthorizedError } from "@/api/account/api";

configureAccountApi({ readAnalyticsEnabled: () => analytics.isAnalyticsEnabled() });

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

/**
 * The password did not open an account this device knows signs in with a derived
 * credential. The password is not sent a second time in plain form: a typo
 * would reach the server, and so would the real password if the server lied.
 * The person can ask for that explicitly (`legacy`) after a reset by email.
 */
export class CredentialSignInRefused extends AccountApiError {
  name = "CredentialSignInRefused";
  constructor() {
    super("That password did not work.", 401);
  }
}

export async function accountSignIn(
  email: string,
  password: string,
  options: { legacy?: boolean } = {},
): Promise<AccountAuthUser> {
  // The desktop app sends a credential derived on the device, not the password.
  const credential = options.legacy ? null : await deriveLoginCredential(email, password);
  if (credential) {
    try {
      const user = await persistLogin(await accountApi.signIn(email, credential), "Sign-in");
      markCredentialAccount(user.id, email);
      return user;
    } catch (error) {
      if (!isAccountUnauthorizedError(error)) throw error;
      if (isCredentialEmail(email)) throw new CredentialSignInRefused();
    }
  }
  // An account made before that, or one whose password was reset by email,
  // holds the password itself: the server has seen it, so it must not seed keys.
  const user = await persistLogin(await accountApi.signIn(email, password), "Sign-in");
  unmarkCredentialAccount(user.id);
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

/** Ends the account's server session and forgets its saved cookies, so the
 * next use of this account requires its password. Local cookies are forgotten
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

export async function accountForgotPassword(email: string): Promise<void> {
  await accountApi.forgotPassword(email);
}

export async function accountRegister(
  username: string,
  email: string,
  password: string,
): Promise<AccountAuthUser> {
  // The password protects the sync vault, so its rules are enforced here: the
  // server only ever sees a value derived from it.
  const credential = await deriveLoginCredential(email, password);
  if (credential) {
    const problem = await passwordProblem(email, password);
    if (problem) throw new Error(problem);
  }
  const body = {
    username,
    email,
    password: credential ?? password,
    credential: Boolean(credential),
  };
  const user = await persistLogin(await accountApi.register(body), "Registration");
  if (credential) markCredentialAccount(user.id, email);
  return user;
}

export function accountFetchMe(): Promise<AccountMeResponse> {
  return accountApi.me();
}

export function accountFetchAvatar(): Promise<Blob> {
  return accountApi.avatar();
}

function accountUpdateTelemetryPreferences(
  analyticsEnabled: boolean,
  errorReportingEnabled: boolean,
): Promise<void> {
  return accountApi.updateTelemetry(analyticsEnabled, errorReportingEnabled);
}

configureTelemetryPreferencesSync(accountUpdateTelemetryPreferences);
