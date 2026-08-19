import { cloudConnectionHandoff, type CloudProvider } from "@/api/cloud/api";
import { providersImportCloudConnection } from "@/native";
import type { ProviderConfigStep } from "@/native/contracts";

export function accountProviderForCloud(provider: string): "google" | "microsoft" | "dropbox" {
  if (provider === "drive") return "google";
  if (provider === "onedrive") return "microsoft";
  return "dropbox";
}

export async function importCloudConnection(connection: {
  id: string;
  provider: CloudProvider;
  name: string;
  connection_source?: "connected_account" | "legacy_cloud";
  connected_account_id?: string;
}) {
  const lease = await cloudConnectionHandoff(connection.id);
  await providersImportCloudConnection({
    name: connection.name,
    providerType: connection.provider,
    connectionId: connection.id,
    connectionSource: connection.connection_source,
    connectedAccountId: connection.connected_account_id,
    handoff: lease.handoff,
    redeemUrl: lease.redeem_url,
  });
}

export function completedProviderStep(name: string): ProviderConfigStep {
  return {
    kind: "done",
    name,
    state: "",
    result: "done",
    done: true,
    error: "",
    authorizeUrl: "",
    instructions: "",
    pollAfterMs: 0,
    option: null,
  };
}
