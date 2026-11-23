import { create } from "zustand";

const storageFull =
  "Your storage is full. Free some space in your Library, or get more: on Misty Cloud, choose a " +
  "larger plan in Plan and billing; on your own server, ask whoever runs it. Nothing already " +
  "stored is lost.";

export const accountLimitMessages: Record<string, string> = {
  device_limit_reached:
    "This account has as many signed-in sessions as its plan allows. Sign out of one you no longer use, then try again.",
  no_devices_allowed:
    "This account reached a limit: it can't add signed-in sessions yet. Ask whoever runs your Misty server.",
  storage_limit_reached: storageFull,
  owner_storage_quota_exceeded: storageFull,
  space_people_limit_reached:
    "This Space is full for its level. Boost it on Misty Cloud to raise its level, or remove someone first.",
  space_agent_limit_reached:
    "This Space has as many agents as its level allows. Boost it to raise its level, or take an agent out first.",
  space_upload_limit_reached:
    "This file is larger than this Space's level allows. Boost the Space, or get Misty+ for larger files.",
  space_storage_quota_exceeded:
    "This Space's storage is full. Boost it for more, or free some space in it. Nothing already stored is lost.",
  spaces_limit_reached:
    "You're in as many Spaces as your plan allows, your own and joined ones together. Leave one, or on Misty Cloud choose a larger plan in Plan and billing.",
  account_suspended:
    "This account is suspended, and its data is kept. Contact whoever runs your Misty server.",
  account_closing:
    "This account is closing and is read-only. You can still open and export everything until it is deleted. Subscribe again to keep it.",
};

export function accountLimitMessage(code: string | null | undefined): string | null {
  return code ? (accountLimitMessages[code] ?? null) : null;
}

export const useAccountSuspension = create<{ suspended: boolean }>(() => ({ suspended: false }));

export const useAccountClosing = create<{ deleteAt: string | null }>(() => ({ deleteAt: null }));

export const useAccountNotSetUp = create<{ notSetUp: boolean; hasDevices: boolean }>(() => ({
  notSetUp: false,
  hasDevices: false,
}));

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

const signedInPaths = /\/(?:me|login|register|setup-keys\/redeem|auth\/google\/complete)$/;

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

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
