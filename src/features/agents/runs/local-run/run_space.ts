import { spacesSnapshot } from "@/features/app-windows";
import { homeSpaceOf, spacesKnownFor } from "../../personal/agent_home_space";
import { listPersonalAgents } from "../../personal/personal_agents_api";
import { usePersonalAgentsStore } from "../../personal/personal_agents_store";

export class HomeSpaceGone extends Error {}

async function agentOf(account: string, agentId: string) {
  const known = usePersonalAgentsStore.getState();
  const agents =
    known.accountId === account && known.agents.length
      ? known.agents
      : await listPersonalAgents(account);
  return agents.find((agent) => (agentId ? agent.id === agentId : agent.system_managed)) ?? null;
}

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
