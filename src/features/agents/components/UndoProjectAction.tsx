import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiProgressItem } from "@/features/ai-surface/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { IconButton } from "@/shared/ui";
import { agentsDeviceSnapshot, codeCheckpoints, codeUndo } from "../store/useAgentsStore";

/** Tools that change a project, so their run has an undo copy. */
const changing = /^code[._](write|edit|run|start)$/;

export function changedProject(progress: AiProgressItem[] | undefined): boolean {
  return Boolean(progress?.some((item) => item.type === "tool" && changing.test(item.name)));
}

/** The project and undo copy a run left, looked up across this computer's projects. */
async function runCheckpoint(runId: string) {
  const snapshot = await agentsDeviceSnapshot();
  for (const project of snapshot.scopes.filter((scope) => scope.kind === "project_folder")) {
    const found = (await codeCheckpoints(project.id).catch(() => [])).find(
      (checkpoint) => checkpoint.runId === runId,
    );
    if (found) return { project, checkpoint: found };
  }
  return null;
}

/**
 * Undo on an answer whose run changed a project: puts the project back the way
 * it was before that run (docs/plans/agent-code-projects.md). Shown only while
 * the run's undo copy exists on this computer.
 */
export function UndoProjectAction({ runId }: { runId: string }) {
  const [target, setTarget] = useState<Awaited<ReturnType<typeof runCheckpoint>>>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  useEffect(() => {
    let current = true;
    if (hasTauriInternals())
      void runCheckpoint(runId)
        .then((found) => current && setTarget(found))
        .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [runId]);
  if (!target || !target.checkpoint.complete) return null;
  const name = target.project.displayName;
  const label =
    state === "done"
      ? `Changes to ${name} undone`
      : state === "failed"
        ? `Couldn’t undo the changes to ${name}`
        : `Undo changes to ${name}`;
  return (
    <IconButton
      size="xs"
      label={label}
      disabled={state === "busy" || state === "done"}
      onClick={() =>
        void (async () => {
          const confirmed = await confirmAction(
            `Put ${name} back the way it was before this answer? Files this run added are removed and files it changed are restored.`,
            "Undo changes",
          );
          if (!confirmed) return;
          setState("busy");
          try {
            await codeUndo(target.project.id, target.checkpoint.runId);
            setState("done");
          } catch {
            setState("failed");
          }
        })()
      }
    >
      <Undo2 />
    </IconButton>
  );
}
