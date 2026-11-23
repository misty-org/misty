import type { SpaceEvent, SpaceMember, SpaceMessage } from "../api/dto/entities";
import type { MessageSpan } from "../api/dto/common";

const deletedMessageIds = new Set<string>();
const deletedMessageLimit = 2_000;

export function noteDeletedSpaceMessage(messageId: string): void {
  if (!messageId) return;
  deletedMessageIds.delete(messageId);
  deletedMessageIds.add(messageId);
  if (deletedMessageIds.size <= deletedMessageLimit) return;
  const oldest = deletedMessageIds.values().next().value;
  if (oldest !== undefined) deletedMessageIds.delete(oldest);
}

export function forgetDeletedSpaceMessages(): void {
  deletedMessageIds.clear();
}

export function mergeSpaceMessages(
  current: SpaceMessage[],
  incoming: SpaceMessage[],
): SpaceMessage[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (deletedMessageIds.has(item.id)) continue;
    if (item.client_nonce) {
      for (const [id, existing] of byId) {
        if (id !== item.id && existing.client_nonce === item.client_nonce) byId.delete(id);
      }
    }
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

export function withThreadReply(current: SpaceMessage[], reply: SpaceMessage): SpaceMessage[] {
  return current.map((message) =>
    message.id === reply.thread_root_id
      ? { ...message, reply_count: (message.reply_count ?? 0) + 1, last_reply_at: reply.created_at }
      : message,
  );
}

export function withoutThreadReply(current: SpaceMessage[], rootId: string): SpaceMessage[] {
  return current.map((message) =>
    message.id === rootId
      ? { ...message, reply_count: Math.max(0, (message.reply_count ?? 0) - 1) }
      : message,
  );
}

export type SpaceMessageHistory = "more" | "loading" | "complete";

export function mergeNewestSpaceMessagePage(
  current: SpaceMessage[],
  page: SpaceMessage[],
): { messages: SpaceMessage[]; keptEarlier: boolean } {
  const local = current.filter((message) => message.local_delivery_state);
  const loaded = current.filter((message) => !message.local_delivery_state);
  if (page.length === 0 || loaded.length === 0)
    return { messages: mergeSpaceMessages(local, page), keptEarlier: false };
  const pageOldest = Math.min(...page.map((message) => message.seq));
  const pageNewest = Math.max(...page.map((message) => message.seq));
  const loadedNewest = Math.max(...loaded.map((message) => message.seq));
  const pageIds = new Set(page.map((message) => message.id));
  const overlaps = pageOldest <= loadedNewest;
  const earlier = overlaps ? loaded.filter((message) => message.seq < pageOldest) : [];
  const later = loaded.filter((message) => message.seq > pageNewest && !pageIds.has(message.id));
  return {
    messages: mergeSpaceMessages([...earlier, ...later, ...local], page),
    keptEarlier: earlier.length > 0,
  };
}

function withThreadSummary(next: SpaceMessage, known: SpaceMessage): SpaceMessage {
  if (next.reply_count !== undefined || !known.reply_count) return next;
  return { ...next, reply_count: known.reply_count, last_reply_at: known.last_reply_at };
}

export function mergeSavedSpaceMessage(
  current: SpaceMessage[],
  saved: SpaceMessage,
): SpaceMessage[] {
  const known = current.find((item) => item.id === saved.id);
  return mergeSpaceMessages(current, [known ? withThreadSummary(saved, known) : saved]);
}

export function patchedBySpaceEvent(
  current: SpaceMessage[],
  event: SpaceEvent,
  myUserId: string,
): SpaceMessage[] | null {
  const payload = event.payload;
  const messageId =
    typeof payload.message_id === "string" ? payload.message_id : (event.entity_id ?? "");
  if (event.type === "message.pinned" || event.type === "message.unpinned") return current;
  if (event.type === "message.updated") {
    if (!Array.isArray(payload.content) || !messageId) return null;
    const content = payload.content as SpaceMessage["content"];
    const fileNodeIds = Array.isArray(payload.file_node_ids)
      ? (payload.file_node_ids as string[])
      : undefined;
    const editedAt = typeof payload.edited_at === "string" ? payload.edited_at : undefined;
    return current.map((message) =>
      message.id === messageId
        ? {
            ...message,
            content,
            file_node_ids: fileNodeIds ?? message.file_node_ids,
            edited_at: editedAt ?? message.edited_at,
          }
        : message,
    );
  }
  if (event.type === "message.reaction_added" || event.type === "message.reaction_removed") {
    if (!Array.isArray(payload.reactions) || !messageId) return null;
    const emoji = typeof payload.emoji === "string" ? payload.emoji : "";
    const mine = Boolean(myUserId) && event.actor_user_id === myUserId;
    const reacted = event.type === "message.reaction_added";
    const counts = (payload.reactions as unknown[]).flatMap((entry) => {
      const item = entry as { emoji?: unknown; count?: unknown };
      return typeof item.emoji === "string" && typeof item.count === "number"
        ? [{ emoji: item.emoji, count: item.count }]
        : [];
    });
    return current.map((message) => {
      if (message.id !== messageId) return message;
      const before = new Map(
        (message.reactions ?? []).map((reaction) => [reaction.emoji, reaction.reacted_by_me]),
      );
      return {
        ...message,
        reactions: counts.map((reaction) => ({
          ...reaction,
          reacted_by_me:
            mine && reaction.emoji === emoji ? reacted : Boolean(before.get(reaction.emoji)),
        })),
      };
    });
  }
  return null;
}

export function historyAfterNewestPage(
  previous: SpaceMessageHistory | undefined,
  pageLength: number,
  keptEarlier: boolean,
  pageSize: number,
): SpaceMessageHistory {
  if (keptEarlier) return previous === "complete" ? "complete" : "more";
  return pageLength < pageSize ? "complete" : "more";
}

export function oldestServerMessage(messages: SpaceMessage[]): SpaceMessage | undefined {
  return messages.find((message) => !message.local_delivery_state);
}

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

export interface MentionableAgent {
  agent_id: string;
  agent_name: string;
  owner_user_id?: string;
}

export function buildMessageSpans(
  text: string,
  members: SpaceMember[],
  agents: readonly MentionableAgent[] = [],
  roles: readonly { id: string; name: string }[] = [],
): MessageSpan[] {
  const candidates: { label: string; userId?: string; agentId?: string; roleId?: string }[] = [
    ...members.map((member) => ({ label: member.name, userId: member.user_id })),
    ...agents.map((agent) => ({ label: agent.agent_name, agentId: agent.agent_id })),
    ...roles.map((role) => ({ label: role.name, roleId: role.id })),
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
    else if (candidate?.roleId)
      spans.push({ type: "mention", role_id: candidate.roleId, label: candidate.label });
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
