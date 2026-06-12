import { resolveDeploymentTarget, resolveHostedApiBase } from "@/api/deployment/api";
import { saveSelfHostEntitlementProof, selfHostEntitlementHeader } from "@/api/self-host/proof";

interface MintedEntitlement {
  token: string;
  expires_at: string;
}

export async function mintSelfHostEntitlement(
  hostedToken: string | null,
): Promise<MintedEntitlement> {
  if (!hostedToken) {
    throw new Error("Sign in to Misty Hosted before connecting to a self-hosted server.");
  }
  const response = await fetch(`${resolveHostedApiBase()}/billing/self-host-entitlement`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${hostedToken}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    (Partial<MintedEntitlement> & { code?: string }) | null;
  if (!response.ok || !payload?.token || !payload.expires_at) {
    if (response.status === 403) {
      throw new Error("An active Misty subscription or trial is required for self-hosting.");
    }
    throw new Error("Misty Hosted could not issue a self-host entitlement right now.");
  }
  const entitlement = { token: payload.token, expires_at: payload.expires_at };
  return entitlement;
}

export async function renewSelfHostEntitlement(
  hostedToken: string | null,
  localToken: string | null,
): Promise<MintedEntitlement> {
  const target = await resolveDeploymentTarget();
  if (target.mode !== "self_hosted") return mintSelfHostEntitlement(hostedToken);
  if (!localToken) throw new Error("Sign in to the self-hosted server before renewing access.");
  const entitlement = await mintSelfHostEntitlement(hostedToken);
  const response = await fetch(`${target.apiBase}/self-host/entitlement`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${localToken}`,
      [selfHostEntitlementHeader]: entitlement.token,
    },
  });
  if (!response.ok) {
    throw new Error("The self-hosted server rejected this entitlement proof.");
  }
  await saveSelfHostEntitlementProof(entitlement.token);
  return entitlement;
}
