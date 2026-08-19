import { spacesApi } from "@/api/spaces/api";
import type { SpaceConversation, SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { mergeSpaceMessages } from "@/features/spaces/chat";
import { registerAgentCacheReset } from "./agentCacheLifecycle";

export interface AgentConversationSnapshot {
  conversation: SpaceConversation;
  messages: SpaceMessage[];
  fetchedAt: number;
}

interface CacheEntry {
  snapshot?: AgentConversationSnapshot;
  promise?: Promise<AgentConversationSnapshot>;
  requestVersion?: number;
}

const entries = new Map<string, CacheEntry>();
const idleFreshnessMs = 30_000;

function cacheKey(spaceId: string, agentId: string): string {
  return `${spaceId}:${agentId}`;
}

export function cachedAgentConversation(
  spaceId: string,
  agentId: string,
): AgentConversationSnapshot | undefined {
  return entries.get(cacheKey(spaceId, agentId))?.snapshot;
}

export function loadAgentConversation(
  spaceId: string,
  agentId: string,
  options: { force?: boolean } = {},
): Promise<AgentConversationSnapshot> {
  const key = cacheKey(spaceId, agentId);
  const entry = entries.get(key) ?? {};
  if (entry.promise && !options.force) return entry.promise;
  if (!options.force && entry.snapshot && Date.now() - entry.snapshot.fetchedAt < idleFreshnessMs) {
    return Promise.resolve(entry.snapshot);
  }

  const requestVersion = (entry.requestVersion ?? 0) + 1;
  const request = (async () => {
    // Resolving a direct conversation is a write-shaped, idempotent endpoint.
    // Once known, retain its stable ID and refresh only its messages.
    const conversation =
      entry.snapshot?.conversation ?? (await spacesApi.directAgentConversation(spaceId, agentId));
    const result = await spacesApi.conversationMessages(spaceId, conversation.id);
    const current = entries.get(key);
    const pending = current?.snapshot?.messages.filter((message) => message.local_delivery_state);
    const snapshot = {
      conversation,
      messages: mergeSpaceMessages([...result.messages].reverse(), pending ?? []),
      fetchedAt: Date.now(),
    };
    if ((current?.requestVersion ?? 0) > requestVersion) {
      return current?.snapshot ?? snapshot;
    }
    entries.set(key, { snapshot, requestVersion });
    return snapshot;
  })();
  entries.set(key, { ...entry, promise: request, requestVersion });
  return request.finally(() => {
    const current = entries.get(key);
    if (current?.promise === request) delete current.promise;
  });
}

export function mergeCachedAgentConversationMessages(
  spaceId: string,
  agentId: string,
  incoming: SpaceMessage[],
): void {
  const key = cacheKey(spaceId, agentId);
  const entry = entries.get(key);
  if (!entry?.snapshot) return;
  entries.set(key, {
    ...entry,
    snapshot: {
      ...entry.snapshot,
      messages: mergeSpaceMessages(entry.snapshot.messages, incoming),
      fetchedAt: Date.now(),
    },
  });
}

export function invalidateAgentConversation(spaceId: string, agentId: string): void {
  const entry = entries.get(cacheKey(spaceId, agentId));
  if (entry?.snapshot) entry.snapshot.fetchedAt = 0;
}

export function clearAgentConversationCache(): void {
  entries.clear();
}

registerAgentCacheReset(clearAgentConversationCache);
