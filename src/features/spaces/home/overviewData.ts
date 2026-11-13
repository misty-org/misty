import type { GlobalAiConversation, GitStatus, MistyActivityEntry } from "@/features/agents";
import type { AgentProfile } from "@/shared/schemas";

type Chat = Pick<GlobalAiConversation, "id" | "title" | "agentId" | "updatedAt">;
type Run = Pick<
  MistyActivityEntry,
  "id" | "state" | "conversation_id" | "agent_id" | "title" | "updated_at" | "parent_run_id"
>;

/** A run that stopped to ask its person, with the chat to open for it. */
interface WaitingRun {
  id: string;
  conversationId: string;
  agentId: string;
  title: string;
  /** What it is waiting for, in a few plain words. */
  asks: string;
  updatedAt: string;
}

const needsPerson = (state: string) =>
  state === "awaiting_approval" || state === "awaiting_intervention";

export const chatTitle = (title: string | undefined) => title?.trim() || "New chat";

/**
 * The chats whose latest top-level run is waiting for the person, newest first. Only chats in
 * `chats` count, so a run from another Space never shows here.
 */
export function waitingRuns(entries: Run[], chats: Chat[]): WaitingRun[] {
  const known = new Map(chats.map((chat) => [chat.id, chat]));
  const newest = new Map<string, Run>();
  for (const entry of entries) {
    if (entry.parent_run_id || !known.has(entry.conversation_id)) continue;
    const seen = newest.get(entry.conversation_id);
    if (!seen || entry.updated_at > seen.updated_at) newest.set(entry.conversation_id, entry);
  }
  return [...newest.values()]
    .filter((entry) => needsPerson(entry.state))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((entry) => {
      const chat = known.get(entry.conversation_id);
      return {
        id: entry.id,
        conversationId: entry.conversation_id,
        agentId: entry.agent_id || chat?.agentId || "",
        title: chatTitle(chat?.title || entry.title),
        asks: entry.state === "awaiting_approval" ? "Needs your approval" : "Needs your help",
        updatedAt: entry.updated_at,
      };
    });
}

/** The most recently updated chats, newest first. */
export function recentChats<T extends Chat>(chats: T[], most = 5): T[] {
  return [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, most);
}

/** The agent a chat or run is with: its own, or the built-in one when it names none. */
export function agentOf(agents: AgentProfile[], agentId: string | undefined) {
  return (
    agents.find((agent) => agent.id === agentId) ??
    (agentId ? undefined : agents.find((agent) => agent.system_managed))
  );
}

/** The chat's address on the Agents page. */
export function chatHref(agentId: string | undefined, conversationId: string) {
  const chat = new URLSearchParams();
  if (agentId) chat.set("agent", agentId);
  if (conversationId) chat.set("conversation", conversationId);
  const query = chat.toString();
  return query ? `/agents?${query}` : "/agents";
}

/** A folder's Git state for its row: the branch and how many files changed; null when not a repository. */
export function gitSummary(status: GitStatus | null | undefined) {
  if (!status?.repository) return null;
  const changed = new Set(status.changes.map((change) => change.path)).size;
  return { branch: status.branch || "detached", changed };
}

/** A path with the home folder shortened, for a row with little room. */
export function shortPath(path: string) {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}
