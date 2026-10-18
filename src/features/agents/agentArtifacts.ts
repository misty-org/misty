import { invoke } from "@tauri-apps/api/core";
import { agentArtifactsApi } from "@/api/spaces/agent-artifacts";
import { uploadLibraryPath, type AgentArtifactProvenance } from "@/api/spaces/library-upload";
import { useSpacesStore } from "@/features/spaces";
import { spaceAgentsApi } from "@/api/spaces/space-agents";

/**
 * What agents make is saved to a Space the agent is in (the personal Space
 * when it's there), as Library items that remember which agent, chat and run
 * made them. It counts toward the agent owner's storage. Files stay on this
 * computer too.
 */
export interface AgentArtifactInput {
  agentId: string;
  path: string;
  kind: AgentArtifactProvenance["kind"];
  conversationId?: string;
  runId?: string;
}

/** The Space an agent saves to, with its name for status lines. */
export async function agentHomeSpace(agentId: string): Promise<{ id: string; name: string }> {
  const { agents } = await spaceAgentsApi.mine();
  const memberships = agents.filter((item) => item.agent_id === agentId);
  const spaces = useSpacesStore.getState().spaces;
  const personal = memberships.find((item) =>
    spaces.some(
      (space) => space.id === item.space_id && space.is_default && space.role === "owner",
    ),
  );
  const home = personal ?? memberships[0];
  if (!home) throw new Error("This agent isn’t in any Space. Add it to one from its settings.");
  return { id: home.space_id, name: home.space_name };
}

export async function saveAgentArtifact(input: AgentArtifactInput) {
  const space = await agentHomeSpace(input.agentId);
  const result = await uploadLibraryPath(space.id, input.path, "library", {
    agent: {
      agent_id: input.agentId,
      conversation_id: input.conversationId,
      run_id: input.runId,
      kind: input.kind,
    },
  });
  return { space, itemId: result.item?.id };
}

/** Zips a project after a coding run and saves it to the agent's Space. */
export async function saveProjectSnapshot(input: {
  agentId: string;
  scopeId: string;
  runId: string;
  conversationId?: string;
}) {
  const snapshot = await invoke<{ path: string; name: string; files: number }>("project_snapshot", {
    scopeId: input.scopeId,
    runId: input.runId,
  });
  return saveAgentArtifact({
    agentId: input.agentId,
    path: snapshot.path,
    kind: "code",
    conversationId: input.conversationId,
    runId: input.runId,
  });
}

/** The Space holding a run's project snapshot, when one was saved. */
export async function runSnapshotSpace(agentId: string, runId: string): Promise<string | null> {
  const space = await agentHomeSpace(agentId);
  const { artifacts } = await agentArtifactsApi.list(space.id, agentId);
  return artifacts.some((item) => item.run_id === runId && item.kind === "code")
    ? space.name
    : null;
}
