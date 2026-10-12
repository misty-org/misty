import { invoke } from "@tauri-apps/api/core";
import { parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { mapAllWorkspaceWindowViews } from "@/features/workspace/windows";
import type { ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

/**
 * Device jobs for code projects (docs/plans/agent-code-projects.md). Native
 * code checks the job's run grant, then runs the tool in the project's
 * sandbox; this side only forwards the job and opens previews.
 */
export const codeProjectOperations = new Set([
  "code.read",
  "code.list",
  "code.find",
  "code.search",
  "code.write",
  "code.edit",
  "code.run",
  "code.start",
  "code.logs",
  "code.processes",
  "code.stop",
  "code.preview",
]);

/** Only Misty's own preview server may be opened from a preview result. */
function previewAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port ? url.href : null;
  } catch {
    return null;
  }
}

export async function runCodeProjectOperation(
  job: ClaimedWorkflowNodeJob["job"],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  const output = await invoke<Record<string, unknown>>("code_execute", {
    request: {
      operation: job.operation,
      scopeId: job.scopeId,
      runId: job.runId,
      input: job.input ?? {},
      config: job.config,
    },
  });
  if (job.operation === "code.preview") {
    const url = previewAddress(output.url);
    if (url) {
      // A tab already showing this preview comes forward instead of a new one.
      const workspace = useWorkspaceStore.getState();
      let existing: string | null = null;
      mapAllWorkspaceWindowViews(workspace, (view) => {
        if (
          !existing &&
          view.surfaceId === "browser" &&
          parseBrowserViewState(view.state).url === url
        )
          existing = view.id;
        return view;
      });
      const tabId = existing ?? workspace.openBrowserView({ url }).id;
      if (existing) workspace.focusView(existing);
      return { ...output, opened: true, tabId };
    }
  }
  return output;
}
