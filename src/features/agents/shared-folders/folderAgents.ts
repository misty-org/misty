import { invoke } from "@/native/invoke";
import { notify } from "@/shared/ui";
import { folderName, listEngines, mistyEngine, type EngineInfo } from "../engines/enginesApi";
import { agentAccountId } from "../personal/agentAccount";
import { newAgentOn } from "../personal/personalAgentsApi";
import { selectedPersonalAgent, usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { useAgentFolders, worksInFolder } from "./agentFolder";

/** Every agent that works in `path`. */
export async function agentsInFolder(path: string): Promise<string[]> {
  const rows = await invoke<{ agent: string; path: string }[]>("agent_folder_list", {
    account: agentAccountId(),
  });
  return rows.filter((row) => row.path === path).map((row) => row.agent);
}

/** The agent that works in `path`, if one does. */
export async function agentInFolder(path: string): Promise<string | undefined> {
  return (await agentsInFolder(path))[0];
}

/**
 * Gives the folder a past chat ran in to an agent on that chat's engine, once the person agrees
 * in the system's own dialog (`agent_folder_from_history`). With no `agentId` a new agent is
 * made, named after the folder, only after they agreed. The agent and the folder it was given,
 * or null when they declined.
 */
export async function giveHistoryFolder(
  path: string,
  engineId: string,
  agentId?: string,
): Promise<{ agentId: string; folder: string } | null> {
  const account = agentAccountId();
  let engine: EngineInfo | undefined;
  if (!agentId) {
    engine = (await listEngines()).find((item) => item.id === engineId);
    if (!engine) throw new Error("That AI isn't set up on this computer.");
  }
  const id = agentId ?? `personal_${crypto.randomUUID()}`;
  const folder = await invoke<string | null>("agent_folder_from_history", {
    account,
    agent: id,
    path,
  });
  if (!folder) return null;
  if (engine) {
    await newAgentOn(account, engine, folderName(path), id);
    await usePersonalAgentsStore.getState().load(account);
  }
  useAgentFolders.getState().refresh(id);
  return { agentId: id, folder };
}

/**
 * After a folder is linked to a Space: the agent already working there is picked, or a notice
 * offers a new agent for it, on the same engine as the agent in use, named after the folder.
 */
export async function offerAgentForFolder(space: string, path: string): Promise<void> {
  const owner = await agentInFolder(path).catch(() => undefined);
  if (owner) {
    usePersonalAgentsStore.getState().select(space, owner);
    return;
  }
  notify({
    message: `${folderName(path)} is linked.`,
    action: { label: "Make an agent for it", onSelect: () => void makeAgentFor(space, path) },
  });
}

async function makeAgentFor(space: string, path: string) {
  try {
    const account = agentAccountId();
    const current = selectedPersonalAgent(space);
    const engines = await listEngines();
    const engine =
      engines.find((item) => worksInFolder(current) && item.id === current?.engine) ??
      engines.find((item) => item.id !== mistyEngine && item.installed);
    if (!engine) throw new Error("Set up an AI first.");
    const agent = await newAgentOn(account, engine, folderName(path));
    await invoke<void>("agent_folder_use", { account, agent: agent.id, path });
    useAgentFolders.getState().refresh(agent.id);
    const agents = usePersonalAgentsStore.getState();
    await agents.load(account);
    agents.select(space, agent.id);
  } catch (reason) {
    notify({
      message: reason instanceof Error ? reason.message : "That agent couldn't be made.",
      tone: "error",
    });
  }
}
