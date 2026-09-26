import { useEffect, useState } from "react";
import type { GlobalAiMessage } from "@/features/global-search/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Skeleton } from "@/shared/ui";
import { agentsDeviceSnapshot, projectGitDiff, projectRunDiff } from "../../store/useAgentsStore";
import { useConversationProject } from "../../store/useConversationProject";
import { ChangesSection, RunChanges } from "./ChangesSection";
import type { DiffSet } from "./diffTypes";
import { useProjectReview } from "./useProjectReview";

/** An answer that handed coding to the person's coding tool. */
const delegated = /^code[._]delegate$/;
const settled = new Set(["completed", "failed", "canceled"]);

export function delegatedCoding(message: GlobalAiMessage): boolean {
  return Boolean(
    message.progress?.some((item) => item.type === "tool" && delegated.test(item.name)),
  );
}

type Changes = { runs: Array<{ runId: string; diff: DiffSet }>; project: DiffSet | null };

/** Each finished run's own changes; without any, the project's uncommitted ones. */
async function loadChanges(scopeId: string, runIds: string[]): Promise<Changes> {
  const runs = (
    await Promise.all(
      runIds.map((runId) =>
        projectRunDiff(scopeId, runId)
          .then((diff) => ({ runId, diff }))
          .catch(() => null),
      ),
    )
  ).filter((run): run is { runId: string; diff: DiffSet } => Boolean(run?.diff.files.length));
  if (runs.length) return { runs, project: null };
  return { runs, project: await projectGitDiff(scopeId) };
}

/**
 * What an answer that delegated coding changed, like Claude Code and Codex
 * show it: each run's files with their +/- counts, each opening to its diff,
 * with Undo and Review. When Misty has no copy from before a run, the files
 * git sees as changed since the last commit. Shown only on the computer the
 * project is on.
 */
export function AnswerChanges({
  message,
  conversationId,
}: {
  message: GlobalAiMessage;
  conversationId?: string;
}) {
  const finished = message.state !== "pending" && message.state !== "streaming";
  const scopeId = useConversationProject((s) =>
    conversationId ? s.byConversation[conversationId] : null,
  );
  const relevant = Boolean(finished && scopeId && hasTauriInternals() && delegatedCoding(message));
  const runKey = (message.subagents ?? [])
    .filter((child) => settled.has(child.state))
    .map((child) => child.invocationId)
    .join(" ");
  const [name, setName] = useState("");
  const [changes, setChanges] = useState<Changes | null>();
  const openReview = useProjectReview((s) => s.open);
  const agentId = useMistyStore(
    (state) => state.conversations.find((item) => item.id === conversationId)?.agentId,
  );
  useEffect(() => {
    if (!relevant || !scopeId) return;
    let current = true;
    void agentsDeviceSnapshot()
      .then(
        (snapshot) =>
          current &&
          setName(
            snapshot.scopes.find((scope) => scope.id === scopeId)?.displayName ?? "the project",
          ),
      )
      .catch(() => undefined);
    void loadChanges(scopeId, runKey ? runKey.split(" ") : [])
      .then((loaded) => current && setChanges(loaded))
      .catch(() => current && setChanges(null));
    return () => {
      current = false;
    };
  }, [relevant, scopeId, runKey]);
  if (!relevant || !scopeId || changes === null) return null;
  if (changes === undefined)
    return (
      <div className="misty-changes" aria-hidden="true">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  const review = () => openReview(scopeId);
  if (changes.runs.length)
    return (
      <>
        {changes.runs.map((run) => (
          <RunChanges
            key={run.runId}
            scopeId={scopeId}
            runId={run.runId}
            name={name}
            diff={run.diff}
            agentId={agentId}
            conversationId={conversationId}
            onReview={review}
          />
        ))}
      </>
    );
  if (!changes.project?.files.length) return null;
  return (
    <ChangesSection
      name={name}
      diff={changes.project}
      actions={
        <Button variant="ghost" size="sm" onClick={review}>
          Review
        </Button>
      }
    />
  );
}
