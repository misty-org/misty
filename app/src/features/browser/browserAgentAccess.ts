import { invoke } from "@tauri-apps/api/core";

export const browserAgentCapabilities = [
  "browser.inspect",
  "browser.navigate",
  "browser.click",
  "browser.downloads.list",
] as const;

// Run contexts replace the old Space-wide grants. The browser runtime retains
// this local shape only so it can detach a native tab when the tab or run closes.
export interface ActiveBrowserAgentGrant {
  id: string;
  agentId: string;
  spaceId: string;
  scopeId: string;
  expiresAt: string;
}

export async function revokeBrowserAgentGrant(
  runtimeId: string,
  grant: ActiveBrowserAgentGrant,
): Promise<void> {
  await invoke("browser_agent_grant_revoke", {
    request: { id: runtimeId, grantId: grant.id },
  }).catch(() => undefined);
}
