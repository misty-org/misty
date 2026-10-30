import { invoke } from "@tauri-apps/api/core";
import { resolveApiBase } from "@/api/deployment/api";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * In the desktop app the Misty password never reaches the server. The app
 * derives two unrelated values from it on this device: a login credential,
 * sent where the password used to go, and a key that opens the sync vault.
 * Accounts made before this still hold the password itself on the server.
 *
 * The device remembers which accounts it has seen sign in with a credential,
 * and the exact email the keys were derived from. Both are local only; the
 * server holds nothing that says so.
 */
const storageKey = "misty-credential-accounts";

/** Account id → the email its keys are derived from, as typed. */
function readMarked(): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey);
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

const normalize = (email: string) => email.trim().toLowerCase();

/** Accounts whose password the server has only ever seen as a derived credential. */
export function isCredentialAccount(accountId: string | null | undefined): boolean {
  return Boolean(accountId) && typeof readMarked()[accountId as string] === "string";
}

/** Whether this email is a known credential account, before its id is known (at sign-in). */
export function isCredentialEmail(email: string): boolean {
  const wanted = normalize(email);
  return Object.values(readMarked()).some((marked) => normalize(marked) === wanted);
}

/** The email the account's keys are derived from, so they are rebuilt the same way every time. */
export function credentialEmail(accountId: string | null | undefined): string | null {
  return accountId ? (readMarked()[accountId] ?? null) : null;
}

export function markCredentialAccount(accountId: string, email: string): void {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...readMarked(), [accountId]: email.trim() }),
    );
  } catch {
    // Without storage the account is simply asked again.
  }
}

/** The server has seen this account's password in plain form (a reset, or an older account). */
export function unmarkCredentialAccount(accountId: string): void {
  try {
    const marked = readMarked();
    delete marked[accountId];
    localStorage.setItem(storageKey, JSON.stringify(marked));
  } catch {
    // Without storage the flag was never kept either.
  }
}

/** The derived login credential, or null where the password is sent as typed (not the desktop app). */
export async function deriveLoginCredential(
  email: string,
  password: string,
): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  return invoke<string>("account_login_credential", {
    deployment: await resolveApiBase(),
    email,
    password,
  });
}

/** Why a new password is not acceptable, or null when it is (or the rules are not enforced here). */
export async function passwordProblem(email: string, password: string): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  return invoke<string | null>("account_check_password", { email, password });
}
