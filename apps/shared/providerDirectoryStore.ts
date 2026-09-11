import { loadMailWebsiteAccounts } from "./mailWebsiteAccounts";
import { uniquePagePins } from "./pagePins";
import { loadProviderPins, type ProviderPin } from "./providerPins";
import type { MistyAppSDK, MistyNavigationItem } from "@misty/sdk";
import { loadWebsiteAccounts, notifyProviderAccounts } from "./accountStore";
import { providers, type ProviderId, type WebsiteAccount } from "./providers";

export interface ProviderDirectoryState {
  accounts: WebsiteAccount[];
  pins?: ProviderPin[];
  added: Set<ProviderId>;
  hidden: Set<ProviderId>;
  mailError?: string;
}
export const providerAppPath = (appId: "chat" | "inbox") =>
  `/apps/${appId === "chat" ? "social" : "inbox"}`;
export async function loadProviderDirectory(
  misty: MistyAppSDK,
  appId: "chat" | "inbox",
  onLocal?: (state: ProviderDirectoryState) => void | Promise<void>,
): Promise<ProviderDirectoryState> {
  const accounts = await loadWebsiteAccounts(misty.storage.local);
  // A saved website profile is a shortcut, not proof of provider authorization.
  const added = new Set<ProviderId>(
    accounts.map((account) => account.provider),
  );
  const hidden = new Set<ProviderId>();
  await Promise.all(
    (Object.keys(providers) as ProviderId[]).map(async (id) => {
      if (
        (await misty.storage.local.get(`provider-shortcut-hidden:${id}`)) ===
        true
      )
        hidden.add(id);
    }),
  );
  const pins = await loadProviderPins(misty.storage.local);
  // Website shortcuts stay usable while optional server metadata is pending.
  await onLocal?.({ accounts, pins, added: new Set(added), hidden });
  let mailError: string | undefined;
  if (appId === "inbox") {
    try {
      const accounts = await loadMailWebsiteAccounts(misty);
      for (const account of accounts) {
        if (["google", "gmail"].includes(account.provider)) added.add("google");
        if (["microsoft", "outlook"].includes(account.provider))
          added.add("microsoft");
      }
    } catch {
      mailError =
        "Saved mail integrations could not be loaded. Your website sign-ins are unaffected.";
    }
  }
  return {
    accounts,
    pins,
    added,
    hidden,
    mailError,
  };
}
export function providerNavigationItems(
  appId: "chat" | "inbox",
  state: ProviderDirectoryState,
): MistyNavigationItem[] {
  return [
    ...(appId === "chat"
      ? [
          {
            id: "misty",
            label: "Misty",
            route: `${providerAppPath(appId)}?provider=misty`,
          },
        ]
      : []),
    ...Object.entries(providers)
      .filter(
        ([id, p]) =>
          p.family === appId &&
          state.added.has(id as ProviderId) &&
          !state.hidden.has(id as ProviderId),
      )
      .map(([id, p]) => ({
        id,
        label: p.label,
        route: `${providerAppPath(appId)}?provider=${id}`,
        children: uniquePagePins(state.pins ?? [])
          .filter(
            (pin) =>
              pin.provider === id &&
              state.accounts.some((a) => a.id === pin.accountId),
          )
          .map((pin) => ({
            id: `pin-${pin.id}`,
            label: pin.label,
            route: `${providerAppPath(appId)}?provider=${id}&websiteAccount=${encodeURIComponent(pin.accountId)}&pin=${encodeURIComponent(pin.id)}`,
          })),
      })),
  ];
}
export async function setProviderShortcut(
  misty: MistyAppSDK,
  id: ProviderId,
  visible: boolean,
) {
  await misty.storage.local.set(`provider-shortcut-hidden:${id}`, !visible);
  notifyProviderAccounts();
}
