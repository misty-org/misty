export const filesAgentScopeKey = "files";

export function spaceAgentScopeKey(accountId: string, spaceId: string): string {
  return `account:${encodeURIComponent(accountId)}:space:${encodeURIComponent(spaceId)}`;
}

export function agentScopeKey(accountId: string, agentId = "", spaceId = "", modelId = ""): string {
  const params = new URLSearchParams();
  if (agentId) params.set("agent", agentId);
  if (spaceId) params.set("space", spaceId);
  if (modelId) params.set("model", modelId);
  return `account:${encodeURIComponent(accountId)}:agents?${params.toString()}`;
}

export function parseAgentScopeKey(
  scopeKey: string,
): { agentId?: string; spaceId?: string; modelId?: string; reasoningEffort?: string } | null {
  const marker = ":agents?";
  const offset = scopeKey.indexOf(marker);
  if (offset < 0) return null;
  const params = new URLSearchParams(scopeKey.slice(offset + marker.length));
  return {
    agentId: params.get("agent") || undefined,
    spaceId: params.get("space") || undefined,
    modelId: params.get("model") || undefined,
  };
}

export function spaceIdFromAgentScopeKey(scopeKey: string): string | undefined {
  const agentScope = parseAgentScopeKey(scopeKey);
  if (agentScope) return agentScope.spaceId;
  const marker = ":space:";
  const index = scopeKey.lastIndexOf(marker);
  if (index < 0) return undefined;
  try {
    return decodeURIComponent(scopeKey.slice(index + marker.length)) || undefined;
  } catch {
    return undefined;
  }
}
