import type { MessageSpan, SpaceMember, SpaceMessage, SpaceStudioResource } from "../spaces/types";

export function mergeSpaceMessages(
  current: SpaceMessage[],
  incoming: SpaceMessage[],
): SpaceMessage[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

export function buildMessageSpans(
  text: string,
  members: SpaceMember[],
  agents: SpaceStudioResource[],
): MessageSpan[] {
  const candidates = [
    ...members.map((member) => ({ label: member.name, userId: member.user_id, agentId: "" })),
    ...agents.map((agent) => ({ label: agent.name, userId: "", agentId: agent.id })),
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
    const candidate = candidates.find(
      (item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    if (candidate?.userId)
      spans.push({ type: "mention", user_id: candidate.userId, label: candidate.label });
    else if (candidate?.agentId)
      spans.push({ type: "mention", agent_id: candidate.agentId, label: candidate.label });
    else spans.push({ type: "text", text: match[0] });
    offset = index + match[0].length;
  }
  if (offset < text.length) spans.push({ type: "text", text: text.slice(offset) });
  return spans.length ? spans : [{ type: "text", text }];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
