import { invoke } from "@tauri-apps/api/core";
import { openPullRequest, pull, push } from "./git/gitSync";
import { commitAuthor, projectGit } from "./git/projectGit";
import { parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { mapAllWorkspaceWindowViews } from "@/features/workspace/windows";
import type { ClaimedWorkflowNodeJob } from "./workerBrowserJobs";

/**
 * Device jobs for code projects (docs/plans/agent-code-projects.md) and their
 * Git (docs/plans/agent-git-projects.md). Native code checks the job's run
 * grant, then runs the tool in the project's sandbox or its repository; this
 * side forwards the job, adds the commit author, runs GitHub transfers and
 * opens previews.
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
  "git.status",
  "git.diff",
  "git.log",
  "git.commit",
  "git.branch",
  "git.push",
  "git.pull",
  "git.pull_request",
]);

/** Git steps that talk to GitHub: checked natively, then run here. */
const githubOperations = new Set(["git.push", "git.pull", "git.pull_request"]);

/** A result the model reads as a refusal it should explain, not retry. */
function refused(message: string): Record<string, unknown> {
  return { status: "failure", tool_error: { message } };
}

async function runGitHubOperation(
  job: ClaimedWorkflowNodeJob["job"],
): Promise<Record<string, unknown>> {
  const check = await invoke<{ allowed: boolean; reason?: string }>("code_git_job", {
    request: { operation: job.operation, scopeId: job.scopeId, config: job.config },
  });
  if (!check.allowed) return refused(check.reason ?? "That isn't allowed for this project.");
  const transport = projectGit(job.scopeId);
  try {
    if (job.operation === "git.push") return { ...(await push(transport)) };
    if (job.operation === "git.pull") return { ...(await pull(transport)) };
    const input = (job.input ?? {}) as { title?: string; body?: string };
    return {
      ...(await openPullRequest(transport, { title: input.title ?? "", body: input.body })),
    };
  } catch (error) {
    // GitHub refusals (no access, newer commits) are the agent's to explain.
    return refused(error instanceof Error ? error.message : "GitHub refused that.");
  }
}

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
  if (githubOperations.has(job.operation)) return runGitHubOperation(job);
  // Commits are by the person's account, chosen here; never by the agent.
  const input =
    job.operation === "git.commit"
      ? { ...((job.input ?? {}) as Record<string, unknown>), author: await commitAuthor() }
      : (job.input ?? {});
  const output = await invoke<Record<string, unknown>>("code_execute", {
    request: {
      operation: job.operation,
      scopeId: job.scopeId,
      runId: job.runId,
      input,
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
