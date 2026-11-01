import { create } from "zustand";

/**
 * Accounts a Misty Cloud setup key signed in on this device that have no password yet. The
 * password opens the sync vault, so sync waits until one is chosen, and the wizard asks again
 * the next time the account is signed in here. Local only, like the credential marks beside it.
 */
const storageKey = "misty-password-pending";

/** Account id → the email its keys will be derived from. */
function read(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null") as unknown;
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

function write(pending: Record<string, string>): void {
  try {
    if (Object.keys(pending).length) localStorage.setItem(storageKey, JSON.stringify(pending));
    else localStorage.removeItem(storageKey);
  } catch {
    // Without storage the account is still marked for this run of the app.
  }
}

export const usePendingPasswords = create<{ pending: Record<string, string> }>(() => ({
  pending: read(),
}));

export function markPasswordPending(accountId: string, email: string): void {
  const pending = { ...usePendingPasswords.getState().pending, [accountId]: email.trim() };
  write(pending);
  usePendingPasswords.setState({ pending });
}

export function clearPasswordPending(accountId: string): void {
  const { [accountId]: _cleared, ...pending } = usePendingPasswords.getState().pending;
  write(pending);
  usePendingPasswords.setState({ pending });
}

/** The email to derive the keys from, or null when the account needs no password here. */
export function pendingPasswordEmail(accountId: string | null | undefined): string | null {
  return accountId ? (usePendingPasswords.getState().pending[accountId] ?? null) : null;
}

export function usePasswordPending(accountId: string | null | undefined): boolean {
  return usePendingPasswords((state) => Boolean(accountId && state.pending[accountId]));
}
