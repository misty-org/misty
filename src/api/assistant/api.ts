import { cachedRequest } from "@/api/cache/cached-request";
import { apiRequest } from "@/api/client";

export const assistantApi = {
  conversations: <T>(query = "", onCached?: (value: { conversations: T[] }) => void) =>
    cachedRequest<{ conversations: T[] }>(
      `/misty/conversations${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      { onCached },
    ),
  /** A new conversation goes to the Space the window shows; none is the personal Space. */
  createConversation: <T>(title: string, spaceId?: string, agentId?: string) =>
    apiRequest<T>("/misty/conversations", {
      method: "POST",
      body: JSON.stringify({ title, space_id: spaceId, agent_id: agentId }),
    }),
  /** Takes finished turns out of a conversation, so the next run's history doesn't have them. */
  dropTurns: (conversationId: string, invocationIds: string[]) =>
    apiRequest(`/misty/conversations/${encodeURIComponent(conversationId)}/turns`, {
      method: "POST",
      body: JSON.stringify({ action: "detach", invocation_ids: invocationIds }),
    }),
  /** Moves a turn to another of the person's conversations. */
  moveTurn: (conversationId: string, invocationId: string, toConversationId: string) =>
    apiRequest(`/misty/conversations/${encodeURIComponent(conversationId)}/turns`, {
      method: "POST",
      body: JSON.stringify({
        action: "move",
        invocation_ids: [invocationId],
        to_conversation_id: toConversationId,
      }),
    }),
  /** Saves a reply's edited requirements ledger (docs/agents/checkpoints.md). */
  saveLedger: (conversationId: string, invocationId: string, rows: unknown[]) =>
    apiRequest(`/misty/conversations/${encodeURIComponent(conversationId)}/ledger`, {
      method: "POST",
      body: JSON.stringify({ invocation_id: invocationId, rows }),
    }),
  /** Teach-mode lessons and courses. */
  lessons: <L, C>() => apiRequest<{ lessons: L[]; courses: C[] }>("/misty/lessons"),
  saveLesson: (kind: "lesson" | "course", id: string, document: unknown) =>
    apiRequest(`/misty/lessons/${kind}/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(document),
    }),
  removeLesson: (kind: "lesson" | "course", id: string) =>
    apiRequest(`/misty/lessons/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteConversation: (conversationId: string) =>
    apiRequest(`/misty/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
  renameConversation: (conversationId: string, title: string) =>
    apiRequest<{ id: string; title: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ title }) },
    ),
  /** Records that the user has seen the conversation now. */
  markConversationRead: (conversationId: string) =>
    apiRequest<{ id: string; lastReadAt: string }>(
      `/misty/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ read: true }) },
    ),
  complete: (prompt: string) =>
    apiRequest<{ text: string }>("/ai/complete", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      }),
    }),
};
