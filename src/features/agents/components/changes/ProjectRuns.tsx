import { useCallback, useEffect, useState } from "react";
import { Button, SkeletonList } from "@/shared/ui";
import { projectCheckpoints, projectUndo } from "../../store/useAgentsStore";
import { plainFailure, undoneText } from "./undoText";

type Run = { runId: string; createdAt: number; complete: boolean };

const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * The coding runs this project can still undo, newest first: each puts the
 * project back to how it was before that run. Misty keeps the last 20 runs
 * per project for 14 days.
 */
export function ProjectRuns({
  scopeId,
  name,
  onChanged,
}: {
  scopeId: string;
  name: string;
  onChanged(): void;
}) {
  const [runs, setRuns] = useState<Run[]>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ text: string; failed: boolean }>();
  const load = useCallback(async () => {
    setRuns(await projectCheckpoints(scopeId).catch(() => []));
  }, [scopeId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (runs === undefined)
    return <SkeletonList label="Coding runs" rows={2} leading="none" lines={1} />;
  if (!runs.length && !notice) return null;
  const undo = async (run: Run) => {
    setBusy(run.runId);
    try {
      setNotice({ text: undoneText(name, await projectUndo(scopeId, run.runId)), failed: false });
      onChanged();
      await load();
    } catch (problem) {
      setNotice({
        text: plainFailure(problem, `Misty couldn’t undo the changes to ${name}.`),
        failed: true,
      });
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="misty-project-runs" aria-label="Coding runs you can undo">
      <h3>Coding runs you can undo</h3>
      {notice ? (
        <p className="misty-diff-note" role={notice.failed ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
      {runs.map((run) => (
        <div key={run.runId} className="misty-project-run">
          <span>Changes from {when(run.createdAt)}</span>
          {run.complete ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => void undo(run)}
            >
              Undo
            </Button>
          ) : (
            <span className="misty-diff-note">Too large to undo</span>
          )}
        </div>
      ))}
    </section>
  );
}
