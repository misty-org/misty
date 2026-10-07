import { MistyBrowserUrlSchema, type MistyBrowserProvider } from "@/shared/schemas";

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
const popupStorageKey = (tabId: string) => `misty:provider-browser-tab:${tabId}`;
export function inheritProviderBrowser(
  tabId: string,
  sourceId: string,
  url: string,
  popupInstanceKey?: string,
) {
  const profile = views.get(sourceId);
  if (profile && MistyBrowserUrlSchema.safeParse(url).success) {
    const inherited = { ...profile, url };
    popups.set(tabId, popupInstanceKey ? { ...inherited, popupInstanceKey } : inherited);
    // Save only account/profile identifiers. Native popup handles are process-local.
    const { popupInstanceKey: _transient, url: _transientUrl, ...persistent } = inherited;
    try {
      localStorage.setItem(popupStorageKey(tabId), JSON.stringify(persistent));
    } catch {
      /* The live popup still retains its account. */
    }
  }
}
