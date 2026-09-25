import type { MistyAppSDK } from "@misty/sdk";
import { savedWebsiteUrl } from "./websiteIntegrations";
import { notifyProviderAccounts } from "./accountStore";
import { providers, type ProviderId } from "./providers";
type Storage = MistyAppSDK["storage"]["local"];
export interface ProviderPin {
  id: string;
  provider: ProviderId;
  accountId: string;
  label: string;
  url: string;
  order: number;
}
const prefix = "provider-page-pin-v1:";
export async function loadProviderPins(
  storage: Storage,
): Promise<ProviderPin[]> {
  const values = await Promise.all(
    (await storage.keys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => storage.get<ProviderPin>(key)),
  );
  return values
    .filter(
      (p): p is ProviderPin =>
        !!p &&
        typeof p.id === "string" &&
        typeof p.accountId === "string" &&
        typeof p.label === "string" &&
        p.provider in providers &&
        !!savedWebsiteUrl(p.provider, p.url) &&
        Number.isFinite(p.order),
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export async function saveProviderPin(storage: Storage, pin: ProviderPin) {
  if (!pin.label.trim() || !savedWebsiteUrl(pin.provider, pin.url))
    throw new Error(
      "Open a website page before pinning it. Sign-in pages cannot be pinned.",
    );
  await storage.set(prefix + pin.id, {
    ...pin,
    label: pin.label.trim().slice(0, 200),
  });
  notifyProviderAccounts();
}
export async function deleteProviderPin(storage: Storage, id: string) {
  await storage.delete(prefix + id);
  notifyProviderAccounts();
}
