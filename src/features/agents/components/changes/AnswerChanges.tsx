import { FileDiff, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { GlobalAiMessage } from "@/features/global-search/types";
import { confirmAction } from "@/shared/lib/confirmAction";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Skeleton } from "@/shared/ui";
import { codeRunDiff, codeUndo } from "../../store/useAgentsStore";
import { DiffCounts, DiffFile } from "./DiffView";
import type { DiffSet } from "./diffTypes";
import { changedProject, runCheckpoint } from "./projectRuns";
import { useProjectReview } from "./useProjectReview";

type Target = NonNullable<Awaited<ReturnType<typeof runCheckpoint>>>;

/**
 * What an answer changed in its project, like Claude Code and Codex show it:
 * the files with their +/- counts, each opening to its diff, with Review and
 * Undo. Shown only on the computer the project is on, while the run's undo
 * copy exists (docs/plans/agent-code-projects.md).
 */
export function AnswerChanges({ message }: { message: GlobalAiMessage }) {
  const runId = message.invocationId;
  const finished = message.state !== "pending" && message.state !== "streaming";
  const relevant = Boolean(
    runId && finished && hasTauriInternals() && changedProject(message.progress),
  );
  const [target, setTarget] = useState<Target | null>();
  const [diff, setDiff] = useState<DiffSet | null>();
  const [state, setState] = useState<"idle" | "busy" | "undone" | "failed">("idle");
  const openReview = useProjectReview((s) => s.open);

  useEffect(() => {
    if (!relevant || !runId) return;
    let current = true;
    void (async () => {
      const found = await runCheckpoint(runId).catch(() => null);
      if (!current) return;
      setTarget(found);
      if (!found) return;
      const set = await codeRunDiff(found.project.id, runId).catch(() => null);
      if (current) setDiff(set);
    })();
    return () => {
      current = false;
    };
  }, [relevant, runId]);

  if (!relevant || target === null) return null;
  if (target === undefined || diff === undefined)
    return (
      <div className="misty-changes" aria-hidden="true">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  if (state === "undone")
    return (
      <p className="misty-changes misty-diff-note" role="status">
        Changes to {target.project.displayName} undone.
      </p>
    );
  if (!diff || !diff.files.length) return null;
  const name = target.project.displayName;
  const count = diff.files.length + diff.moreFiles;
  const undo = async () => {
    const confirmed = await confirmAction(
      `Put ${name} back the way it was before this answer? ` +
        "Files it added are removed and files it changed are restored. " +
        "Commits it made are removed too unless they're already on GitHub.",
      "Undo changes",
    );
    if (!confirmed) return;
    setState("busy");
    try {
      await codeUndo(target.project.id, target.checkpoint.runId);
      setState("undone");
    } catch {
      setState("failed");
    }
  };
  return (
    <section className="misty-changes" aria-label={`Changes to ${name}`}>
      <header className="misty-changes-header">
        <FileDiff size={15} aria-hidden="true" />
        <strong>
          Changed {count} {count === 1 ? "file" : "files"} in {name}
        </strong>
        <DiffCounts additions={diff.additions} deletions={diff.deletions} />
        <span className="misty-changes-actions">
          <Button variant="ghost" size="sm" onClick={() => openReview(target.project.id)}>
            Review
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={state === "busy" || !target.checkpoint.complete}
            onClick={() => void undo()}
          >
            <Undo2 size={14} aria-hidden="true" />
            Undo
          </Button>
        </span>
      </header>
      {state === "failed" ? (
        <p className="misty-diff-note" role="alert">
          Those changes couldn’t be undone.
        </p>
      ) : null}
      <div className="misty-diff">
        {diff.files.map((file) => (
          <DiffFile key={file.path} file={file} defaultOpen={false} />
        ))}
      </div>
    </section>
  );
}
