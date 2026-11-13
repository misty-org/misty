import { spaceForNewItems, useSpaceWindowStore } from "@/features/app-windows";
import type { AgentProfile } from "@/shared/schemas";
import { localDocuments } from "../conversations/state/localChats";

/**
 * An agent's home Space: the one Space it works and saves in, whichever Space the window shows. A
 * Space is the server's, never a folder. An agent made before agents had one, or before the
 * account's Spaces loaded, calls the person's own Space home, saved once the Spaces load.
 */

const kind = "agent" as const;

/** The person's own Space, once this account's Spaces have loaded; empty until then. */
export function ownSpaceOf(account: string): string {
  const { personalSpaceId, personalSpaceOwner } = useSpaceWindowStore.getState();
  return personalSpaceOwner === account ? (personalSpaceId ?? "") : "";
}

/** Whether this account's Spaces have loaded, so a Space missing from them is really gone. */
export const spacesKnownFor = (account: string) =>
  useSpaceWindowStore.getState().personalSpaceOwner === account;

/** The Space a new agent made in this window calls home: the one the window shows. */
export function newAgentHomeSpace(account: string): string {
  const { spaceId, personal } = spaceForNewItems();
  if (personal) return ownSpaceOf(account);
  return spaceId ?? "";
}

/** The Space an agent works in: its own, or the person's own Space for one that has none yet. */
export const homeSpaceOf = (account: string, agent: Pick<AgentProfile, "space_id"> | null) =>
  agent?.space_id || ownSpaceOf(account);

/**
 * Gives every agent that has no home Space the person's own, and saves it once. A row that
 * changed meanwhile is left for the next listing. The same list back when there is nothing to do.
 */
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

/**
 * Moves an agent to another home Space. Its next run works there. Its version stays, so settings
 * open on it at the same time still save.
 */
export async function moveAgentHome(
  account: string,
  agentId: string,
  spaceId: string,
): Promise<AgentProfile> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await localDocuments.get(account, kind, agentId);
    if (!raw) throw new Error("This agent is gone.");
    const current = JSON.parse(raw) as AgentProfile;
    const next: AgentProfile = {
      ...current,
      space_id: spaceId,
      updated_at: new Date().toISOString(),
    };
    if (await localDocuments.swap(account, kind, agentId, raw, JSON.stringify(next))) return next;
  }
  throw new Error("This agent changed since it was opened. Open it again and retry.");
}
