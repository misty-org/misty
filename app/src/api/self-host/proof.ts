import { resolveDeploymentTarget } from "@/api/deployment/api";
import { selfHostEntitlementLoad, selfHostEntitlementStore } from "@/native";

export const selfHostEntitlementHeader = "X-Misty-Self-Hosted-Entitlement";

export function saveSelfHostEntitlementProof(token: string): Promise<void> {
  return selfHostEntitlementStore(token);
}

export function loadSelfHostEntitlementProof(): Promise<string | null> {
  return selfHostEntitlementLoad();
}

export async function attachSelfHostEntitlementProof(headers: Headers): Promise<void> {
  if ((await resolveDeploymentTarget()).mode !== "self_hosted") return;
  const proof = await loadSelfHostEntitlementProof();
  if (proof) headers.set(selfHostEntitlementHeader, proof);
}
