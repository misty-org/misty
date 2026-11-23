import { TurnStatus, useNow } from "@misty/ui";
import { doingLabel, memberAgentsIn, useMemberAgents } from "../../list/member_agents";

function fileName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function listed(names: string[]) {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export function AgentWorkLine({
  spaceId,
  userId,
  agentId,
}: {
  spaceId: string;
  userId: string;
  agentId: string;
}) {
  const bySpace = useMemberAgents((state) => state.bySpace);
  const now = useNow();
  const agent = memberAgentsIn({ bySpace }, spaceId, now).find(
    (entry) => entry.userId === userId && entry.agent.id === agentId,
  )?.agent;
  if (!agent || agent.state === "resting") return null;
  const waiting = agent.state === "needs-you";
  const files = (agent.files ?? []).map(fileName);
  const phrase = waiting
    ? doingLabel(agent.doing, agent.state)
    : files.length
      ? `Changing ${listed(files)}`
      : doingLabel(agent.doing, agent.state);
  return (
    <div className="pl-18">
      <TurnStatus phrase={phrase} waiting={waiting} />
    </div>
  );
}
