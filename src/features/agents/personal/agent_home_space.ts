import { useSpaceWindowStore } from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import { localDocuments } from "../conversations/state/local_chats";

const kind = "agent" as const;

export function ownSpaceOf(account: string): string {
  const { personalSpaceId, personalSpaceOwner } = useSpaceWindowStore.getState();
  return personalSpaceOwner === account ? (personalSpaceId ?? "") : "";
}

export const spacesKnownFor = (account: string) =>
  useSpaceWindowStore.getState().personalSpaceOwner === account;

export function newAgentHomeSpace(account: string): string {
  return ownSpaceOf(account);
}

export const homeSpaceOf = (account: string, agent: Pick<AgentProfile, "space_id"> | null) =>
  agent?.space_id || ownSpaceOf(account);

export async function placeUnplacedAgents(
  account: string,
  agents: AgentProfile[],
): Promise<AgentProfile[]> {
  const own = ownSpaceOf(account);
  if (!own || agents.every((agent) => agent.space_id)) return agents;
  const placed: AgentProfile[] = [];
  for (const agent of agents) {
    if (agent.space_id) {
      placed.push(agent);
      continue;
    }
    const raw = await localDocuments.get(account, kind, agent.id).catch(() => null);
    if (!raw) {
      placed.push(agent);
      continue;
    }
    const current = JSON.parse(raw) as AgentProfile;
    const next = { ...current, space_id: current.space_id || own };
    const saved = await localDocuments
      .swap(account, kind, agent.id, raw, JSON.stringify(next))
      .catch(() => false);
    placed.push(saved ? next : agent);
  }
  return placed;
}
