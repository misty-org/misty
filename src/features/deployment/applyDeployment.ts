import {
  inspectSelfHostedServer,
  saveDeploymentConfiguration,
  validateSelfHostedServerUrl,
  type DeploymentMode,
} from "@/api/deployment/api";
import { mintSelfHostEntitlement } from "@/api/self-host/entitlement";
import { saveSelfHostEntitlementProof } from "@/api/self-host/proof";
import { readHostedAccountAuthToken } from "@/features/auth";
import { relaunch } from "@tauri-apps/plugin-process";

export interface DeploymentChange {
  mode: DeploymentMode;
  url?: string;
}

/**
 * Moves this device onto another Misty server.
 *
 * A self-hosted target is verified and entitled *before* anything is written,
 * so a bad URL or an unverifiable subscription leaves the current connection
 * untouched. Routing, caches and stores are all namespaced per deployment, so
 * the app has to restart once the change lands.
 */
export async function applyDeployment(change: DeploymentChange): Promise<void> {
  if (change.mode === "self_hosted") {
    const url = validateSelfHostedServerUrl(change.url ?? "");
    const descriptor = await inspectSelfHostedServer(url);
    const entitlement = await mintSelfHostEntitlement(await readHostedAccountAuthToken());
    await saveSelfHostEntitlementProof(entitlement.token);
    await saveDeploymentConfiguration("self_hosted", url, descriptor);
  } else {
    await saveDeploymentConfiguration("hosted");
  }
  await relaunch();
}
