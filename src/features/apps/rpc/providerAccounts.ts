import { mistyBrowserProviders, type MistyBrowserProvider } from "@misty/sdk";
import { browserProfileId } from "./browserIdentity";

type Provider = MistyBrowserProvider;

// Identity families are explicit. A service offering “Sign in with Google” does
// not thereby get access to the user's Google browser session.
const families: Partial<Record<Provider["id"], Provider["id"]>> = {
  google: "google",
  "google-drive": "google",
  "google-docs": "google",
  "google-calendar": "google",
  youtube: "google",
  "youtube-music": "google",
  microsoft: "microsoft",
  onedrive: "microsoft",
  "microsoft-word": "microsoft",
  "microsoft-onenote": "microsoft",
  "outlook-calendar": "microsoft",
  "microsoft-todo": "microsoft",
  "microsoft-teams": "microsoft",
  icloud: "icloud",
  "apple-music": "icloud",
  jira: "jira",
  trello: "jira",
};

export function sharedProviderAccount(provider: Provider): boolean {
  return provider.accountId === `default-${provider.id}`;
}

/** Shared defaults retain the original Inbox profile, including existing cookies.
 * Named/legacy profiles keep their exact identity; matching labels or email
 * addresses are never sufficient grounds to merge two authenticated sessions.
 */
export async function providerAccountProfile(
  serverBase: string,
  ownerAccountId: string,
  appId: string,
  provider: Provider,
): Promise<string> {
  if (!sharedProviderAccount(provider))
    return browserProfileId(serverBase, ownerAccountId, appId, provider);
  const id = families[provider.id] ?? provider.id;
  return browserProfileId(serverBase, ownerAccountId, mistyBrowserProviders[id].owner, {
    id,
    accountId: `default-${id}`,
  });
}

const prefix = "misty:provider-account-v1:";
interface ProviderAccountRecord {
  family: string;
  shared: boolean;
  integrations: Array<{ id: Provider["id"]; accountId: string }>;
}

/** Host-owned account directory. Only opaque profile IDs and integration links
 * are stored here. Cookies and credentials remain in native browser storage;
 * OAuth refresh/access tokens remain in the existing server credential store.
 * Each profile has its own record, so unrelated accounts cannot overwrite it.
 */
function read(profileId: string): ProviderAccountRecord | undefined {
  const raw = localStorage.getItem(prefix + profileId);
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as ProviderAccountRecord;
    if (
      typeof value.family === "string" &&
      typeof value.shared === "boolean" &&
      Array.isArray(value.integrations) &&
      value.integrations.every(
        (item) => item && typeof item.id === "string" && typeof item.accountId === "string",
      )
    )
      return value;
  } catch {
    // This directory is metadata, never authority to choose a native profile.
  }
}

export function rememberProviderAccount(profileId: string, provider: Provider) {
  const previous = read(profileId);
  const integrations = previous?.integrations ?? [];
  if (
    !integrations.some((item) => item.id === provider.id && item.accountId === provider.accountId)
  )
    integrations.push({ id: provider.id, accountId: provider.accountId });
  localStorage.setItem(
    prefix + profileId,
    JSON.stringify({
      family: families[provider.id] ?? provider.id,
      shared: sharedProviderAccount(provider),
      integrations,
    } satisfies ProviderAccountRecord),
  );
}

export function unlinkProviderAccount(profileId: string, provider: Provider) {
  const record = read(profileId);
  if (!record) return;
  if (!sharedProviderAccount(provider)) {
    localStorage.removeItem(prefix + profileId);
    return;
  }
  // Removing an integration is not signing out of the provider across all apps.
  record.integrations = record.integrations.filter(
    (item) => item.id !== provider.id || item.accountId !== provider.accountId,
  );
  localStorage.setItem(prefix + profileId, JSON.stringify(record));
}
