import type { AgentProfile } from "@/shared/contracts";
import { searchApi } from "@/api/search/api";
import type { GlobalAiConversation } from "@/features/global-search/types";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
} from "@/features/files/workspace/explorer/utils/globalSearch";
import type { SearchResult } from "@/native/contracts";

export interface ScopedSearchResult {
  id: string;
  kind: "file" | "folder" | "space" | "space-item" | "agent" | "conversation";
  title: string;
  subtitle: string;
  target:
    | { kind: "files"; result: SearchResult }
    | { kind: "route"; route: string }
    | { kind: "agent"; agentId: string; conversationId: string };
}

export const resultLimit = 12;

export async function searchIndexedFiles(query: string): Promise<SearchResult[]> {
  try {
    return await queryIndexedExplorerSearch(query, { limit: resultLimit * 2 }, null);
  } catch {
    return [];
  }
}

/** Semantic hits cover file contents, captions and media transcripts. Space
 * library hits are left to `/spaces` so the two scopes don't overlap. */
export async function searchFileContents(
  query: string,
  indexed: SearchResult[],
): Promise<SearchResult[]> {
  try {
    const semantic = await querySemanticExplorerSearch(query, { limit: resultLimit * 2 });
    return mergeHybridSearchResults(
      indexed,
      semantic.filter((hit) => hit.entry.location.providerType !== "misty-space"),
      resultLimit,
    );
  } catch {
    return indexed;
  }
}

export function fileResults(hits: SearchResult[]): ScopedSearchResult[] {
  return hits.slice(0, resultLimit).map((hit) => ({
    id: `file:${hit.entry.path}#${hit.match?.mediaSegmentId ?? ""}`,
    kind: hit.entry.kind === "folder" ? "folder" : "file",
    title: hit.entry.name,
    subtitle:
      hit.match?.kind === "semantic" && hit.match.description
        ? hit.match.description
        : (hit.entry.location.remoteName ?? hit.entry.path),
    target: { kind: "files", result: hit },
  }));
}

export async function searchSpaces(
  query: string,
  spaces: { id: string; name: string }[],
): Promise<ScopedSearchResult[]> {
  const needle = query.toLocaleLowerCase();
  const named = spaces
    .filter((space) => space.name.toLocaleLowerCase().includes(needle))
    .slice(0, resultLimit)
    .map<ScopedSearchResult>((space) => ({
      id: `space:${space.id}`,
      kind: "space",
      title: space.name,
      subtitle: "Space",
      target: { kind: "route", route: `/spaces/${encodeURIComponent(space.id)}/social` },
    }));
  if (query.length < 2) return named;
  try {
    const { hits } = await searchApi.spaceLibraries(query, resultLimit);
    return [
      ...named,
      ...hits.map<ScopedSearchResult>((hit) => ({
        id: `space-item:${hit.space_id}:${hit.item.id}`,
        kind: "space-item",
        title: hit.item.display_name,
        subtitle: hit.space_name,
        target: { kind: "route", route: hit.deep_link },
      })),
    ];
  } catch {
    return named;
  }
}

export function searchAgents(
  query: string,
  agents: AgentProfile[],
  conversations: GlobalAiConversation[],
): ScopedSearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (text: string) => !needle || text.toLocaleLowerCase().includes(needle);
  const fallbackAgentId = agents.find((agent) => agent.system_managed)?.id ?? "";
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const agentHits = agents
    .filter((agent) => matches(`${agent.name} ${agent.role}`))
    .map<ScopedSearchResult>((agent) => ({
      id: `agent:${agent.id}`,
      kind: "agent",
      title: agent.name,
      subtitle: agent.role || "Agent",
      target: { kind: "agent", agentId: agent.id, conversationId: "" },
    }));
  const conversationHits = [...conversations]
    .filter((conversation) => matches(conversation.title))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map<ScopedSearchResult>((conversation) => {
      const agentId = conversation.agentId || fallbackAgentId;
      return {
        id: `conversation:${conversation.id}`,
        kind: "conversation",
        title: conversation.title || "Untitled conversation",
        subtitle: agentNames.get(agentId) ?? "Conversation",
        target: { kind: "agent", agentId, conversationId: conversation.id },
      };
    });
  return [...agentHits, ...conversationHits].slice(0, resultLimit);
}
