import {
  websiteIntegrations,
  type WebsiteIntegrationId,
} from "./websiteIntegrations";
import { mistyBrowserProviders, type MistyBrowserProvider } from "@misty/sdk";
export type ProviderFamily =
  "inbox" | "chat" | "journal" | "planner" | "library";
export type ProviderId = MistyBrowserProvider["id"];
export const providers: Record<
  ProviderId,
  { label: string; url: string; family: ProviderFamily }
> = {
  ...(Object.fromEntries(
    Object.entries(mistyBrowserProviders).map(([id, policy]) => [
      id,
      {
        label: websiteIntegrations[id as WebsiteIntegrationId]?.label ?? id,
        url: policy.url,
        family: policy.owner,
      },
    ]),
  ) as Record<
    ProviderId,
    { label: string; url: string; family: ProviderFamily }
  >),
  slack: {
    label: "Slack",
    url: mistyBrowserProviders.slack.url,
    family: "chat",
  },
  "microsoft-teams": {
    label: "Microsoft Teams",
    url: mistyBrowserProviders["microsoft-teams"].url,
    family: "chat",
  },
  icloud: {
    label: "iCloud Mail",
    url: mistyBrowserProviders.icloud.url,
    family: "inbox",
  },
  yahoo: {
    label: "Yahoo Mail",
    url: mistyBrowserProviders.yahoo.url,
    family: "inbox",
  },
  google: {
    label: "Gmail",
    url: "https://mail.google.com/mail/u/0/#inbox",
    family: "inbox",
  },
  microsoft: {
    label: "Outlook",
    url: "https://outlook.live.com/mail/",
    family: "inbox",
  },
  instagram: {
    label: "Instagram",
    url: "https://www.instagram.com/direct/inbox/",
    family: "chat",
  },
  messenger: {
    label: "Messenger",
    url: "https://www.messenger.com/",
    family: "chat",
  },
  x: { label: "X", url: "https://x.com/messages", family: "chat" },
  discord: {
    label: "Discord",
    url: "https://discord.com/channels/@me",
    family: "chat",
  },
};
export function providerFromRoute(
  route: string,
  family: ProviderFamily,
): ProviderId | null {
  const url = new URL(route, "https://misty.local");
  const value = url.searchParams.get("provider") ?? "";
  return Object.prototype.hasOwnProperty.call(providers, value) &&
    providers[value as ProviderId].family === family
    ? (value as ProviderId)
    : null;
}
/** Shared by the package mount and host visibility manager. */
export function providerWebsiteFromRoute(
  route: string,
  family: ProviderFamily,
): ProviderId | null {
  const provider = providerFromRoute(route, family);
  const experience = new URL(route, "https://misty.local").searchParams.get(
    "experience",
  );
  if (!provider) return null;
  if (
    family !== "inbox" &&
    experience === "api" &&
    !["slack", "microsoft-teams", "icloud", "yahoo"].includes(provider)
  )
    return null;
  return provider;
}
export interface WebsiteAccount {
  id: string;
  provider: ProviderId;
  label: string;
  connectionId?: string;
  email?: string;
  websiteUrl?: string;
}
export function parseWebsiteAccounts(value: unknown): WebsiteAccount[] {
  if (typeof value !== "string") return [];
  try {
    const items: unknown = JSON.parse(value);
    if (!Array.isArray(items)) return [];
    const seen = new Set<string>();
    return items
      .filter((item): item is WebsiteAccount => {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,160}$/.test(item.id) ||
          seen.has(item.id) ||
          !Object.prototype.hasOwnProperty.call(providers, item.provider) ||
          typeof item.label !== "string" ||
          item.label.length > 200
        )
          return false;
        if (
          item.connectionId !== undefined &&
          typeof item.connectionId !== "string"
        )
          return false;
        if (item.email !== undefined && typeof item.email !== "string")
          return false;
        if (
          item.websiteUrl !== undefined &&
          (item.provider !== "microsoft" ||
            ![
              "https://outlook.live.com/mail/",
              "https://outlook.live.com/mail/?prompt=select_account",
              "https://outlook.office365.com/mail/",
              "https://outlook.cloud.microsoft/mail/",
              "https://outlook.live.com/mail/0/inbox",
              "https://outlook.office.com/mail/",
            ].includes(item.websiteUrl))
        )
          return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 100)
      .map((account) =>
        (account.websiteUrl === "https://outlook.live.com/mail/0/inbox" ||
         account.websiteUrl === "https://outlook.live.com/mail/?prompt=select_account")
          ? { ...account, websiteUrl: providers.microsoft.url }
          : account,
      );
  } catch {
    return [];
  }
}

/** Remember only mailbox landing addresses, never SSO URLs, tokens, or message IDs.
 * This is navigation continuity, not proof of an authenticated account. */
export function outlookMailboxDestination(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["outlook.live.com", "outlook.office.com", "outlook.office365.com", "outlook.cloud.microsoft"].includes(url.hostname) ||
        !/^\/mail(?:\/|$)/.test(url.pathname)) return;
    return `${url.origin}/mail/`;
  } catch { return; }
}
