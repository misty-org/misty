import type { AiProgressItem } from "@/features/ai-surface/types";
import type { AgentScope } from "../../model/interfaces/types";
import {
  agentsDeviceSnapshot,
  codeCheckpoints,
  type CodeCheckpoint,
} from "../../store/useAgentsStore";

/** Tools that change a project, so their run has an undo copy. */
const changing = /^(code[._](write|edit|run|start)|git[._](commit|branch))$/;

export function changedProject(progress: AiProgressItem[] | undefined): boolean {
  return Boolean(progress?.some((item) => item.type === "tool" && changing.test(item.name)));
}

/** The project and undo copy a run left, looked up across this computer's projects. */
export async function runCheckpoint(
  runId: string,
): Promise<{ project: AgentScope; checkpoint: CodeCheckpoint } | null> {
  const snapshot = await agentsDeviceSnapshot();
  for (const project of snapshot.scopes.filter((scope) => scope.kind === "project_folder")) {
    const found = (await codeCheckpoints(project.id).catch(() => [])).find(
      (checkpoint) => checkpoint.runId === runId,
    );
    if (found) return { project, checkpoint: found };
  }
  return null;
}
