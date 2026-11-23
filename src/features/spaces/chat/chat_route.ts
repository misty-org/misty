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

export function conversationPath(spaceId: string, conversation: { id: string }): string {
  return spaceChatConversationPath(spaceId, conversation.id);
}
