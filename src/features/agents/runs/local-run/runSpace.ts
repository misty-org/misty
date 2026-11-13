import { spacesSnapshot } from "@/features/app-windows";
import { homeSpaceOf, spacesKnownFor } from "../../personal/agentHomeSpace";
import { listPersonalAgents } from "../../personal/personalAgentsApi";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";

/** A run whose agent's home Space was deleted, or the person left it. Nothing was started. */
export class HomeSpaceGone extends Error {}

async function agentOf(account: string, agentId: string) {
  const known = usePersonalAgentsStore.getState();
  const agents =
    known.accountId === account && known.agents.length
      ? known.agents
      : await listPersonalAgents(account);
  // A run that names no agent is Misty's own.
  return agents.find((agent) => (agentId ? agent.id === agentId : agent.system_managed)) ?? null;
}

/**
 * The one Space a run works in: its agent's home Space, never the chat's or the window's. Empty
 * only while the account's Spaces haven't loaded for an agent that has none yet; its Space tools
 * then work in the person's own Space (`tools/space/routing.ts`).
 */
export async function runHomeSpace(account: string, agentId: string | undefined): Promise<string> {
  const agent = await agentOf(account, agentId ?? "");
  const home = homeSpaceOf(account, agent);
  const { spaces } = spacesSnapshot();
  if (home && spacesKnownFor(account) && spaces.length && !spaces.some((s) => s.id === home)) {
    const name = agent?.name || "This agent";
    throw new HomeSpaceGone(
      `${name}'s home Space is gone: it was deleted, or you left it. Pick a new home Space in its settings.`,
    );
  }
  return home;
}
