import { apiRequest } from "@/api/client";
import {
  agentsDeviceSnapshot,
  browserDeviceSessionId,
  ensureServerAgentDevice,
  type PersonalAgentGrant,
  personalAgentsApi,
} from "@/features/agents";
import { invoke } from "@tauri-apps/api/core";

export const browserAgentCapabilities = [
  "browser.inspect",
  "browser.navigate",
  "browser.click",
  "browser.downloads.list",
] as const;

export interface ActiveBrowserAgentGrant {
  id: string;
  agentId: string;
  spaceId: string;
  scopeId: string;
  expiresAt: string;
}

interface ServerDeviceGrant {
  id: string;
  agent_id: string;
  space_id: string;
  scope_id: string;
  expires_at: string;
}

export async function grantBrowserAgentAccess(input: {
  runtimeId: string;
  scopeId: string;
  agentId: string;
  title: string;
  url: string;
}): Promise<ActiveBrowserAgentGrant[]> {
  const snapshot = await agentsDeviceSnapshot();
  if (!snapshot.device || snapshot.device.status === "revoked") {
    throw new Error("This Misty device is unavailable for Agent work.");
  }
  const device = await ensureServerAgentDevice(snapshot.device);
  const spaceGrants = await personalAgentsApi.grants(input.agentId);
  if (spaceGrants.grants.length === 0) {
    throw new Error("This Agent must belong to a Space before it can use a browser tab.");
  }
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const origin = browserOrigin(input.url);
  const created: ActiveBrowserAgentGrant[] = [];
  try {
    for (const membership of uniqueSpaceGrants(spaceGrants.grants)) {
      const grant = await apiRequest<ServerDeviceGrant>(
        `/spaces/${encodeURIComponent(membership.space_id)}/agents/${encodeURIComponent(input.agentId)}/device-grants`,
        {
          method: "POST",
          body: JSON.stringify({
            device_id: device.id,
            scope_id: input.scopeId,
            capabilities: browserAgentCapabilities,
            expires_at: expiresAt,
            metadata: {
              kind: "browser_tab",
              sessionId: browserDeviceSessionId,
              label: input.title || origin || "Browser tab",
              origin,
            },
          }),
        },
      );
      const activeGrant = {
        id: grant.id,
        agentId: input.agentId,
        spaceId: membership.space_id,
        scopeId: input.scopeId,
        expiresAt: grant.expires_at,
      };
      created.push(activeGrant);
      await invoke("browser_agent_grant_register", {
        request: {
          id: input.runtimeId,
          scopeId: input.scopeId,
          grantId: grant.id,
          agentId: input.agentId,
          capabilities: browserAgentCapabilities,
          expiresAt: grant.expires_at,
        },
      });
    }
    return created;
  } catch (error) {
    await Promise.allSettled(
      created.map((grant) => revokeBrowserAgentGrant(input.runtimeId, grant)),
    );
    throw error;
  }
}

export async function revokeBrowserAgentGrant(
  runtimeId: string,
  grant: ActiveBrowserAgentGrant,
): Promise<void> {
  await invoke("browser_agent_grant_revoke", {
    request: { id: runtimeId, grantId: grant.id },
  }).catch(() => undefined);
  await apiRequest(
    `/spaces/${encodeURIComponent(grant.spaceId)}/agents/${encodeURIComponent(grant.agentId)}/device-grants/${encodeURIComponent(grant.id)}`,
    { method: "DELETE" },
  );
}

function uniqueSpaceGrants(grants: PersonalAgentGrant[]): PersonalAgentGrant[] {
  const seen = new Set<string>();
  return grants.filter((grant) => {
    if (seen.has(grant.space_id)) return false;
    seen.add(grant.space_id);
    return true;
  });
}

function browserOrigin(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}
