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
  const loadedNewest = Math.max(...loaded.map((message) => message.seq));
  const earlier =
    pageOldest <= loadedNewest ? loaded.filter((message) => message.seq < pageOldest) : [];
  return {
    messages: mergeSpaceMessages([...earlier, ...local], page),
    keptEarlier: earlier.length > 0,
  };
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
