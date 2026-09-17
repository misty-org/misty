import type { AgentIntegrationDestination } from "@misty/contracts";
import { appLocalStoragePrefix } from "@/features/apps/appLocalStorage";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { resolveRequiredApiBase } from "@/api/client";
import {
  browserProviders,
  providerBelongsToApp,
  providerUrlAllowed,
} from "@/features/webviews/browserProviders";

export const integrationDestinationKey = (
  base: string,
  account: string,
  space: string,
  app: string,
) =>
  `misty:agent-destinations:v1:${encodeURIComponent(base)}:${encodeURIComponent(account)}:${encodeURIComponent("")}:${encodeURIComponent(app)}`;
function parse(value: unknown): unknown {
  try {
    return typeof value === "string" ? parse(JSON.parse(value)) : value;
  } catch {
    return null;
  }
}
/** Read the same account/Space storage as the owning app, including pre-registration installs. */
export async function assignedIntegrationDestinations(
  accountId: string,
  spaceId: string,
  appIds: string[],
): Promise<AgentIntegrationDestination[]> {
  const base = await resolveRequiredApiBase();
  await useAppsStore.getState().load(accountId, false, spaceId);
  const store = useAppsStore.getState();
  if (store.accountId !== accountId) throw new Error("The account changed.");
  const result: AgentIntegrationDestination[] = [];
  for (const appId of appIds) {
    const registered = parse(
      localStorage.getItem(integrationDestinationKey(base, accountId, spaceId, appId)),
    );
    if (Array.isArray(registered)) {
      for (const item of registered) {
        const entry = item as AgentIntegrationDestination;
        if (
          entry.appId === appId &&
          providerBelongsToApp(appId, entry.providerId as keyof typeof browserProviders) &&
          providerUrlAllowed(entry.providerId as keyof typeof browserProviders, entry.url)
        )
          result.push(entry);
      }
      continue;
    }
    const app = store.catalog.find((app) => app.id === appId);
    if (!app) continue;
    const prefix = appLocalStoragePrefix(base, accountId, app.app_id ?? appId, spaceId);
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const owned = key.slice(prefix.length);
      if (
        !owned.startsWith("website-integration-v1:account:") &&
        !owned.startsWith("provider-website-account-v2:") &&
        owned !== "provider-website-accounts-v1"
      )
        continue;
      const value = parse(localStorage.getItem(key));
      for (const item of Array.isArray(value) ? value : [value]) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const provider = String(record.provider ?? "") as keyof typeof browserProviders;
        const id = String(record.id ?? "");
        if (
          record.removing ||
          !browserProviders[provider] ||
          !providerBelongsToApp(appId, provider) ||
          !/^[a-zA-Z0-9_-]{1,160}$/.test(id)
        )
          continue;
        const url = String(record.websiteUrl ?? record.url ?? browserProviders[provider].url);
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
        } catch {
          continue;
        }
        if (!providerUrlAllowed(provider, url)) continue;
        const destination = {
          id: `${appId}:${provider}:${id}`,
          appId,
          providerId: provider,
          accountId: id,
          label: String(record.label ?? provider),
          url,
        };
        if (!result.some((item) => item.id === destination.id)) result.push(destination);
      }
    }
  }
  return result;
}
