// Run contexts replace the old Space-wide grants. The browser runtime retains
// this local shape only so it can detach a native tab when the tab or run closes.
export interface ActiveBrowserAgentGrant {
  id: string;
  agentId: string;
  spaceId: string;
  scopeId: string;
  expiresAt: string;
}
