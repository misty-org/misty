import type { SpaceEvent, SpaceMember, SpaceMessage } from "../api/dto/entities";
import type { MessageSpan } from "../api/dto/common";

export function mergeSpaceMessages(
  current: SpaceMessage[],
  incoming: SpaceMessage[],
): SpaceMessage[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (item.client_nonce) {
      for (const [id, existing] of byId) {
        if (id !== item.id && existing.client_nonce === item.client_nonce) byId.delete(id);
      }
    }
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

/**
 * How far back a chat can still read: `more` while older pages may exist, `loading` while one is
 * read, `complete` once the first message is in.
 */
export type SpaceMessageHistory = "more" | "loading" | "complete";

/**
 * Lays a fresh newest page (oldest first) over what a chat shows. Pending sends stay. Older pages
 * already read stay too when the page reaches back into them, so a reload never drops the history
 * someone scrolled back through; when it doesn't (many messages came in meanwhile), they go, so
 * no gap is left in the middle. `keptEarlier` says whether they stayed.
 */
export function mergeNewestSpaceMessagePage(
  current: SpaceMessage[],
  page: SpaceMessage[],
): { messages: SpaceMessage[]; keptEarlier: boolean } {
  const local = current.filter((message) => message.local_delivery_state);
  const loaded = current.filter((message) => !message.local_delivery_state);
  if (page.length === 0 || loaded.length === 0)
    return { messages: mergeSpaceMessages(local, page), keptEarlier: false };
  const pageOldest = Math.min(...page.map((message) => message.seq));
  const loadedNewest = Math.max(...loaded.map((message) => message.seq));
  const earlier =
    pageOldest <= loadedNewest ? loaded.filter((message) => message.seq < pageOldest) : [];
  return {
    messages: mergeSpaceMessages([...earlier, ...local], page),
    keptEarlier: earlier.length > 0,
  };
}

/** The history state after a fresh newest page of `pageLength` messages. */
export function historyAfterNewestPage(
  previous: SpaceMessageHistory | undefined,
  pageLength: number,
  keptEarlier: boolean,
  pageSize: number,
): SpaceMessageHistory {
  if (keptEarlier) return previous === "complete" ? "complete" : "more";
  return pageLength < pageSize ? "complete" : "more";
}

/** The oldest message the server has, the one an older page is read before. */
export function oldestServerMessage(messages: SpaceMessage[]): SpaceMessage | undefined {
  return messages.find((message) => !message.local_delivery_state);
}

/** Message events carry the full record when it can be applied without a refetch. */
export function messageFromSpaceEvent(event: SpaceEvent): SpaceMessage | undefined {
  const payload = event.payload;
  if (
    !event.type.startsWith("message.") ||
    typeof payload.id !== "string" ||
    typeof payload.space_id !== "string" ||
    typeof payload.seq !== "number" ||
    !Array.isArray(payload.content) ||
    !Array.isArray(payload.file_node_ids) ||
    typeof payload.sender_user_id !== "string" ||
    typeof payload.sender_name !== "string" ||
    typeof payload.sender_kind !== "string" ||
    typeof payload.created_at !== "string"
  ) {
    return undefined;
  }
  return payload as unknown as SpaceMessage;
}

/** One of the person's own agents, which they can @mention to ask for help. */
export interface MentionableAgent {
  agent_id: string;
  agent_name: string;
  /** Who it belongs to: a mention runs only on its owner's computer. */
  owner_user_id?: string;
}

export function buildMessageSpans(
  text: string,
  members: SpaceMember[],
  agents: readonly MentionableAgent[] = [],
): MessageSpan[] {
  const candidates: { label: string; userId?: string; agentId?: string }[] = [
    ...members.map((member) => ({ label: member.name, userId: member.user_id })),
    ...agents.map((agent) => ({ label: agent.agent_name, agentId: agent.agent_id })),
  ]
    .filter((item) => item.label.trim())
    .sort((left, right) => right.label.length - left.label.length);
  if (candidates.length === 0) return [{ type: "text", text }];
  const pattern = new RegExp(
    `@(${candidates.map((item) => escapeRegExp(item.label)).join("|")})(?=\\s|$|[.,!?])`,
    "gi",
  );
  const spans: MessageSpan[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) spans.push({ type: "text", text: text.slice(offset, index) });
    const label = match[1];
    const matching = candidates.filter(
      (item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    const candidate = matching.length === 1 ? matching[0] : undefined;
    if (candidate?.userId)
      spans.push({ type: "mention", user_id: candidate.userId, label: candidate.label });
    else if (candidate?.agentId)
      spans.push({ type: "mention", agent_id: candidate.agentId, label: candidate.label });
    else spans.push({ type: "text", text: match[0] });
    offset = index + match[0].length;
  }
  if (offset < text.length) spans.push({ type: "text", text: text.slice(offset) });
  if (!spans.length) return [{ type: "text", text }];
  return spans.reduce<MessageSpan[]>((merged, span) => {
    const previous = merged[merged.length - 1];
    if (previous?.type === "text" && span.type === "text") {
      previous.text += span.text;
    } else {
      merged.push(span);
    }
    return merged;
  }, []);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
