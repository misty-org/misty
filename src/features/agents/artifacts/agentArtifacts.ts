import { spacesSnapshot } from "@/features/app-windows";
import { homeSpaceOf } from "../personal/agentHomeSpace";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { spacesGateway } from "../spaces-gateway/spacesGateway";

/**
 * What agents make is saved into their home Space's drive, in a folder of the agent's own:
 * `/Agents/<agent name>/`. Like anything in the drive it is the Space's, seen by all its members.
 * Files stay on this computer too.
 */
interface AgentArtifactInput {
  agentId: string;
  path: string;
}

/** A name that is safe as one folder of the drive: no separators, never empty. */
function folderSafe(name: string): string {
  const safe = name
    .replace(/[/\\]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safe && safe !== "." && safe !== ".." ? safe : "Agent";
}

/** Where an agent's files go in its home Space's drive. */
export const agentDriveFolder = (agentName: string | undefined) =>
  `/Agents/${folderSafe(agentName ?? "")}`;

/** The folder of an agent's own files, by its id; a run with no agent is Misty's own agent's. */
export function agentFolderOf(agentId: string | undefined): string {
  const { agents } = usePersonalAgentsStore.getState();
  const agent = agents.find((candidate) =>
    agentId ? candidate.id === agentId : candidate.system_managed,
  );
  return agentDriveFolder(agent?.name);
}

/** The agent's home Space, and its name for status lines. */
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
