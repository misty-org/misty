import { mistyBrowserProviders, type MistyBrowserProvider } from "@/shared/schemas";

type ProviderId = MistyBrowserProvider["id"];
type ProviderFamily = (typeof mistyBrowserProviders)[ProviderId]["owner"];

/** The website a tab's `?provider=` names, when it belongs to `family` (older tabs keep it). */
export function providerFromRoute(route: string, family: ProviderFamily): ProviderId | null {
  const url = new URL(route, "https://misty.local");
  const value = url.searchParams.get("provider") ?? "";
  return Object.prototype.hasOwnProperty.call(mistyBrowserProviders, value) &&
    mistyBrowserProviders[value as ProviderId].owner === family
    ? (value as ProviderId)
    : null;
}
