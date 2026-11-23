import { spacesSnapshot } from "@/features/app-windows";
import { homeSpaceOf } from "../personal/agent_home_space";
import { usePersonalAgentsStore } from "../personal/personal_agents_store";
import { spacesGateway } from "../spaces-gateway/spaces_gateway";

interface AgentArtifactInput {
  agentId: string;
  path: string;
}

function folderSafe(name: string): string {
  const safe = name
    .replace(/[/\\]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safe && safe !== "." && safe !== ".." ? safe : "Agent";
}

export const agentDriveFolder = (agentName: string | undefined) =>
  `/Agents/${folderSafe(agentName ?? "")}`;

export function agentFolderOf(agentId: string | undefined): string {
  const { agents } = usePersonalAgentsStore.getState();
  const agent = agents.find((candidate) =>
    agentId ? candidate.id === agentId : candidate.system_managed,
  );
  return agentDriveFolder(agent?.name);
}

function agentHome(agentId: string): { id: string; name: string; agentName: string } {
  const { accountId, agents } = usePersonalAgentsStore.getState();
  const agent = agents.find((candidate) => candidate.id === agentId) ?? null;
  const id = homeSpaceOf(accountId, agent);
  if (!id) throw new Error("Sign in to save this to a Space.");
  const space = spacesSnapshot().spaces.find((candidate) => candidate.id === id);
  return { id, name: space?.name ?? "the Space", agentName: agent?.name ?? "" };
}

export async function saveAgentArtifact(input: AgentArtifactInput) {
  const home = agentHome(input.agentId);
  const file = await spacesGateway
    .get()
    .saveFileToDrive(home.id, agentDriveFolder(home.agentName), input.path);
  return { space: { id: home.id, name: home.name }, file };
}
