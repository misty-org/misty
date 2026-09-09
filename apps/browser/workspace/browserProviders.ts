import { mistyBrowserProviders, MistyBrowserUrlSchema, type MistyBrowserProvider } from "@misty/sdk";

export type BrowserProviderId = MistyBrowserProvider["id"];
export const browserProviders = mistyBrowserProviders;
export function providerUrlAllowed(
  providerId: BrowserProviderId,
  value: string,
) {
  try {
    const url = new URL(value);
    const policy = browserProviders[providerId];
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [...policy.domains, ...policy.auth].some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}
export function providerBelongsToApp(
  appId: string,
  providerId: BrowserProviderId,
) {
  return browserProviders[providerId]?.owner === appId;
}

// Host-only continuity for popup tabs. Package code cannot select or copy a profile.
export interface ProviderBrowserProfile {
  originSpaceId?: string;
  scopeId?: string;
  ownerAppId?: string;
  url?: string;
  profileId: string;
  provider: MistyBrowserProvider;
  ownerAccountId: string;
  serverBase: string;
  popupInstanceKey?: string;
}
const views = new Map<string, ProviderBrowserProfile>();
const popups = new Map<string, ProviderBrowserProfile>();
export function registerProviderBrowser(
  id: string,
  value: ProviderBrowserProfile,
) {
  views.set(id, value);
  return () => {
    views.delete(id);
  };
}
export const providerBrowserProfile = (id: string) => views.get(id);
/** Live host-owned views only; persisted popup metadata is not execution authority. */
export const liveProviderBrowserProfiles = () => [...views].map(([id, profile]) => ({ id, ...profile }));
const popupStorageKey = (tabId: string) =>
  `misty:provider-browser-tab:${tabId}`;
export function popupBrowserProfile(
  tabId: string,
): ProviderBrowserProfile | undefined {
  const active = popups.get(tabId);
  if (active) return active;
  try {
    const value = JSON.parse(
      localStorage.getItem(popupStorageKey(tabId)) ?? "null",
    );
    if (
      value &&
      /^[a-f0-9]{64}$/.test(value.profileId) &&
      typeof value.ownerAccountId === "string" &&
      typeof value.serverBase === "string" &&
      Object.prototype.hasOwnProperty.call(
        browserProviders,
        value.provider?.id,
      ) &&
      /^[a-zA-Z0-9_-]{1,160}$/.test(value.provider?.accountId)
    ) {
      return {
        profileId: value.profileId,
        ownerAccountId: value.ownerAccountId,
        serverBase: value.serverBase,
        provider: value.provider,
        ownerAppId:
          typeof value.ownerAppId === "string" ? value.ownerAppId : undefined,
      };
    }
  } catch {
    /* Unavailable or obsolete local metadata cannot select a profile. */
  }
}
export function inheritProviderBrowser(
  tabId: string,
  sourceId: string,
  url: string,
  popupInstanceKey?: string,
) {
  const profile = views.get(sourceId);
  if (profile && MistyBrowserUrlSchema.safeParse(url).success) {
    const inherited = { ...profile, url };
    popups.set(
      tabId,
      popupInstanceKey ? { ...inherited, popupInstanceKey } : inherited,
    );
    // Save only account/profile identifiers. Native popup handles are process-local.
    const {
      popupInstanceKey: _transient,
      url: _transientUrl,
      ...persistent
    } = inherited;
    try {
      localStorage.setItem(popupStorageKey(tabId), JSON.stringify(persistent));
    } catch {
      /* The live popup still retains its account. */
    }
  }
}
export function consumePopupBrowserInstance(tabId: string) {
  const current = popups.get(tabId);
  if (current?.popupInstanceKey) {
    const { popupInstanceKey: _adopted, ...profile } = current;
    popups.set(tabId, {
      ...profile,
      url: profile.url === "about:blank" ? undefined : profile.url,
    });
  }
}
export function forgetPopupBrowser(tabId: string) {
  popups.delete(tabId);
  try {
    localStorage.removeItem(popupStorageKey(tabId));
  } catch {
    /* Storage may be unavailable. */
  }
}

/** Discard only popup identities attached to the removed, host-derived profile. */
export function forgetProviderProfile(profileId: string) {
  for (const [id, profile] of views) if (profile.profileId === profileId) views.delete(id);
  for (const [id, profile] of popups) if (profile.profileId === profileId) forgetPopupBrowser(id);
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("misty:provider-browser-tab:")) continue;
      if (JSON.parse(localStorage.getItem(key) ?? "null")?.profileId === profileId) localStorage.removeItem(key);
    }
  } catch { /* Ephemeral popup identities were already released. */ }
}
