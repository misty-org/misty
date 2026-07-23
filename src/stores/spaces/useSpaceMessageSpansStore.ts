import type { MessageSpan } from "@/models/types/features/spaces/types";
import type {
  SpaceMember,
  SpaceMessage,
  SpaceStudioResource,
} from "@/models/interfaces/features/spaces/types";

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
  selectedAgentIdsByLabel: Record<string, string> = {},
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
    const matching = candidates.filter(
      (item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    const selectedAgentId = selectedAgentIdsByLabel[label.toLocaleLowerCase()];
    const candidate = selectedAgentId
      ? matching.find((item) => item.agentId === selectedAgentId)
      : matching.length === 1
        ? matching[0]
        : undefined;
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
