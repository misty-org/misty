import { create } from "zustand";

/**
 * What a person sees when their server holds their account to a limit, or suspends it
 * with what to do next. The codes are the server's.
 */
const storageFull =
  "Your storage is full. Free some space in your Library, or ask whoever runs your Misty server for more. Nothing already stored is lost.";

export const accountLimitMessages: Record<string, string> = {
  device_limit_reached:
    "This account has as many signed-in sessions as its plan allows. Sign out of one you no longer use, then try again.",
  no_devices_allowed:
    "This account can't add signed-in sessions yet. Get Misty Pro at mistysys.com/pricing, or ask whoever runs your Misty server.",
  storage_limit_reached: storageFull,
  owner_storage_quota_exceeded: storageFull,
  account_suspended:
    "This account is suspended, and its data is kept. Contact whoever runs your Misty server; for Misty Pro, write to support@mistysys.com.",
  account_closing:
    "This account is closing and is read-only. You can still open and export everything until it is deleted. Subscribe again to keep it.",
};

/** The message for a limit or suspension code, or null for any other code. */
export function accountLimitMessage(code: string | null | undefined): string | null {
  return code ? (accountLimitMessages[code] ?? null) : null;
}

/** Whether the server has said this account is suspended. Cleared by a signed-in answer. */
export const useAccountSuspension = create<{ suspended: boolean }>(() => ({ suspended: false }));

/**
 * When a closing account is deleted (RFC 3339), as the server said in `/me` or a 403
 * `account_closing`, or null while the account is not closing. A closing account is read-only.
 */
export const useAccountClosing = create<{ deleteAt: string | null }>(() => ({ deleteAt: null }));

/** Whether `/me` says this account may have no devices, so sync and Spaces can't start. */
export const useAccountNotSetUp = create<{ notSetUp: boolean; hasDevices: boolean }>(() => ({
  notSetUp: false,
  hasDevices: false,
}));

/** The closing notice's words: read-only, until when, and how to keep the account. */
export function accountClosingMessage(deleteAt: string | null): string {
  const date = deleteAt ? new Date(deleteAt) : null;
  if (!date || Number.isNaN(date.getTime())) return accountLimitMessages.account_closing!;
  const day = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    "This account is closing and is read-only. " +
    `You can open and export everything until ${day}, when it is deleted. ` +
    "Subscribe again before then to keep it."
  );
}

function noteClosing(deleteAt: unknown): void {
  const value = typeof deleteAt === "string" && deleteAt ? deleteAt : null;
  if (useAccountClosing.getState().deleteAt !== value)
    useAccountClosing.setState({ deleteAt: value });
}

// Answers that prove the account is in use again: a profile read or a fresh sign-in.
const signedInPaths = /\/(?:me|login|register|setup-keys\/redeem|auth\/google\/complete)$/;

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** A copy of the answer's JSON body, or null. Watching never fails the caller's request. */
function readJson(response: Response): Promise<Record<string, unknown> | null> {
  let copy: Response;
  try {
    copy = response.clone();
  } catch {
    return Promise.resolve(null);
  }
  return copy
    .text()
    .then((text) => {
      const value: unknown = JSON.parse(text);
      return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    })
    .catch(() => null);
}

/**
 * Watches every answer from the Misty server for `account_suspended` (403 from any signed-in
 * route, sign-in and refresh) and `account_closing` (403 from a change while the account is
 * read-only), and reads `/me`'s `delete_at`. Reads a copy of the body, so the caller's response
 * is untouched.
 */
export function noteAccountResponse(input: RequestInfo | URL, response: Response): void {
  const path = requestPath(input);
  if (response.status === 403) {
    void readJson(response).then((body) => {
      if (body?.code === "account_suspended") useAccountSuspension.setState({ suspended: true });
      if (body?.code === "account_closing") noteClosing(body.delete_at);
    });
    return;
  }
  if (!response.ok) return;
  if (useAccountSuspension.getState().suspended && signedInPaths.test(path))
    useAccountSuspension.setState({ suspended: false });
  if (/\/me$/.test(path))
    void readJson(response).then((body) => {
      if (!body) return;
      noteClosing(body.delete_at);
      useAccountNotSetUp.setState({
        notSetUp: body.devices_allowed === false,
        hasDevices: body.devices_allowed === true,
      });
    });
}
