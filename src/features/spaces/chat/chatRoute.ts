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
