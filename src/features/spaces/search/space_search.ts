import { spaceRequest } from "../api/api";
import type { SpaceMessage } from "../api/dto/core";
import { spaceChatConversationPath, spaceChatPath } from "../chat/chat_route";
import { spansToText } from "../chat/components/message_text";

export interface SpaceSearchHit {
  kind: "notebook" | "message";
  id: string;
  title: string;
  text: string;
  href: string;
  updatedAt?: string;
}

const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;

export async function searchSpaceMessages(
  spaceId: string,
  query: string,
  signal?: AbortSignal,
): Promise<SpaceMessage[]> {
  const words = query.trim();
  if (!spaceId || !words) return [];
  const found = await spaceRequest<{ messages: SpaceMessage[] }>(
    `${base(spaceId)}/messages/search?${new URLSearchParams({ q: words, limit: "25" })}`,
    { signal },
  );
  return found.messages ?? [];
}

const notebookPrefix = "Notebook: ";

export async function searchSpaceText(
  spaceId: string,
  query: string,
  signal?: AbortSignal,
): Promise<SpaceSearchHit[]> {
  const words = query.trim();
  if (!spaceId || !words) return [];
  const notes = new URLSearchParams({
    q: words,
    space_id: spaceId,
    kinds: "note",
    limit: "20",
  });
  const [found, said] = await Promise.allSettled([
    spaceRequest<{ results: { kind: string; id: string; title: string; excerpt: string }[] }>(
      `/search?${notes}`,
      { signal },
    ),
    spaceRequest<{ messages: SpaceMessage[] }>(
      `${base(spaceId)}/messages/search?${new URLSearchParams({ q: words, limit: "20" })}`,
      { signal },
    ),
  ]);
  const hits: SpaceSearchHit[] = [];
  if (found.status === "fulfilled")
    for (const result of found.value.results ?? [])
      if (result.kind === "note")
        hits.push({
          kind: "notebook",
          id: result.id,
          title: result.title.replace(notebookPrefix, "").trim() || "Untitled notebook",
          text: result.excerpt,
          href: `${base(spaceId)}/lab?doc=${encodeURIComponent(result.id)}`,
        });
  if (said.status === "fulfilled")
    for (const message of said.value.messages ?? [])
      hits.push({
        kind: "message",
        id: message.id,
        title: message.sender_name || "Message",
        text: spansToText(message.content),
        href: message.conversation_id
          ? spaceChatConversationPath(spaceId, message.conversation_id)
          : spaceChatPath(spaceId),
        updatedAt: message.created_at,
      });
  signal?.throwIfAborted();
  return hits;
}
