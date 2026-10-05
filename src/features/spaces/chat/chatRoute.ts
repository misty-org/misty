/**
 * Space chat lives at /spaces/:id/social/misty. The path predates the retired
 * social integrations and is kept so saved tabs and links keep working.
 */
export function spaceChatPath(spaceId: string, query?: string | URLSearchParams): string {
  const params =
    query instanceof URLSearchParams
      ? new URLSearchParams(query)
      : new URLSearchParams(query?.replace(/^\?/, "") ?? "");
  params.delete("provider");
  const search = params.toString();
  const base = `/spaces/${encodeURIComponent(spaceId)}/social/misty`;
  return search ? `${base}?${search}` : base;
}

export function spaceChatConversationPath(spaceId: string, conversationId: string): string {
  return spaceChatPath(spaceId, new URLSearchParams({ conversation: conversationId }));
}

/**
 * Where a conversation opens. A chat with an agent is driven by its runs and
 * opens in the agent view; everything else opens in the Space chat.
 */
export function conversationPath(
  spaceId: string,
  conversation: { id: string; direct_agent_id?: string },
): string {
  if (conversation.direct_agent_id) {
    const params = new URLSearchParams({
      agent: conversation.direct_agent_id,
      conversation: conversation.id,
    });
    return `/agents?${params}`;
  }
  return spaceChatConversationPath(spaceId, conversation.id);
}
