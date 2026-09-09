import type { MistyAppSDK } from "@misty/sdk";
import { parseWebsiteAccounts, type WebsiteAccount } from "./providers";
type Storage = MistyAppSDK["storage"]["local"];
const prefix = "provider-website-account-v2:";
// Each account has its own record, so independent workspace tabs cannot overwrite it.
export async function loadWebsiteAccounts(
  storage: Storage,
): Promise<WebsiteAccount[]> {
  const keys = (await storage.keys()).filter((key) => key.startsWith(prefix));
  const stored = (
    await Promise.all(
      keys.map(async (key) => parseWebsiteAccounts(await storage.get(key))),
    )
  ).flat();
  const legacy = parseWebsiteAccounts(
    await storage.get("provider-website-accounts-v1"),
  );
  const accounts = [
    ...stored,
    ...legacy.filter((item) => !stored.some((other) => other.id === item.id)),
  ];
  const missing = legacy.filter(
    (item) => !stored.some((other) => other.id === item.id),
  );
  if (missing.length) await saveWebsiteAccounts(storage, missing);
  return accounts;
}
export async function saveWebsiteAccounts(
  storage: Storage,
  accounts: WebsiteAccount[],
) {
  let changed = false;
  await Promise.all(
    accounts.map(async (account) => {
      const value = JSON.stringify([account]);
      if ((await storage.get(prefix + account.id)) !== value) {
        await storage.set(prefix + account.id, value);
        changed = true;
      }
    }),
  );
  if (changed) notifyProviderAccounts();
}
export async function mailProfileId(connectionId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(connectionId),
  );
  return (
    "mail-" +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}

// Invalidations carry no account data. Each mounted instance rereads its own scoped SDK storage.
export const providerAccountsChanged = "misty:provider-accounts-changed";
export function notifyProviderAccounts() {
  window.dispatchEvent(new Event(providerAccountsChanged));
}
