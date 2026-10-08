import type { AgentProfile } from "@/shared/schemas";
import { searchApi } from "@/api/search/api";
import type { GlobalAiConversation } from "@/features/global-search/types";
import { kuraDownloadUrl, kuraOpen } from "@/native/kura";

export type ScopedSearchKind =
  | "file"
  | "folder"
  | "space"
  | "space-item"
  | "note"
  | "task"
  | "message"
  | "agent"
  | "conversation"
  | "bookmark"
  | "history"
  | "closed-tab"
  | "tab"
  | "download"
  | "setting"
  | "extension"
  | "action";

export interface ScopedSearchResult {
  id: string;
  kind: ScopedSearchKind;
  title: string;
  subtitle: string;
  target:
    | { kind: "route"; route: string }
    | { kind: "agent"; agentId: string; conversationId: string }
    /** A web page or Misty browser page, opened in a new browser tab. */
    | { kind: "url"; url: string }
    /** An open workspace tab to switch to. */
    | { kind: "tab"; tabId: string }
    /** Runs in place; a returned message stays in the box instead of closing it. */
    | { kind: "run"; run: () => string | void };
}

export const resultLimit = 12;

/** Files live in Kura, a separate file manager; `!files` hands the search to it. */
export function kuraSearchResult(query: string, installed: boolean): ScopedSearchResult {
  if (!installed)
    return {
      id: "kura:install",
      kind: "action",
      title: "Search your files with Kura",
      subtitle: "Kura isn't installed. Get Kura, the free file manager",
      target: { kind: "url", url: kuraDownloadUrl },
    };
  return {
    id: `kura:search:${query}`,
    kind: "action",
    title: `Search for “${query}” in Kura`,
    subtitle: "Opens Kura, the file manager",
    target: {
      kind: "run",
      run: () => {
        void kuraOpen({ action: "search", query }).catch(() => undefined);
      },
    },
  };
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
