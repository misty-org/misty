import type { IntegrationProviderDefinition } from "@/features/integrations";

export const inboxProviderCatalog = [
  { id: "google", name: "Gmail", capabilities: ["mail"] },
  { id: "microsoft", name: "Outlook", capabilities: ["mail"] },
] as const satisfies readonly IntegrationProviderDefinition[];

export function inboxProviderName(providerId: string): string {
  return inboxProviderCatalog.find((provider) => provider.id === providerId)?.name ?? providerId;
}
