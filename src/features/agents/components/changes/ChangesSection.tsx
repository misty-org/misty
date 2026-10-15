import { FileDiff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/shared/ui";
import { projectUndo } from "../../store/useAgentsStore";
import { DiffCounts, DiffFile } from "./DiffView";
import type { DiffSet } from "./diffTypes";
import { plainFailure, undoneText } from "./undoText";

/** A set of changed files under a one-line header, with its actions. */
export function ChangesSection({
  name,
  diff,
  actions,
}: {
  name: string;
  diff: DiffSet;
  actions: ReactNode;
}) {
  const count = diff.files.length + diff.moreFiles;
  return (
    <section className="misty-changes" aria-label={`Changes to ${name}`}>
      <header className="misty-changes-header">
        <FileDiff size={15} aria-hidden="true" />
        <strong>
          {count} {count === 1 ? "file" : "files"} changed in {name}
        </strong>
        <DiffCounts additions={diff.additions} deletions={diff.deletions} />
        <span className="misty-changes-actions">{actions}</span>
      </header>
      <div className="misty-diff">
        {diff.files.map((file) => (
          <DiffFile key={file.path} file={file} defaultOpen={false} />
        ))}
      </div>
    </section>
  );
}

/**
 * One delegated run's own changes, with Undo: the project goes back to how it
 * was before the run, and the run's commits go too unless they were pushed.
 */
export function RunChanges({
  scopeId,
  runId,
  name,
  diff,
  onReview,
}: {
  scopeId: string;
  runId: string;
  name: string;
  diff: DiffSet;
  onReview(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  if (done)
    return (
      <p className="misty-changes misty-diff-note" role="status">
        {done}
      </p>
    );
  const undo = async () => {
    setBusy(true);
    setError("");
    try {
      setDone(undoneText(name, await projectUndo(scopeId, runId)));
    } catch (problem) {
      setError(plainFailure(problem, `Misty couldn’t undo the changes to ${name}.`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ChangesSection
        name={name}
        diff={diff}
        actions={
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void undo()}>
              Undo
            </Button>
            <Button variant="ghost" size="sm" onClick={onReview}>
              Review
            </Button>
          </>
        }
      />
      {error ? (
        <p role="alert" className="misty-diff-note">
          {error}
        </p>
      ) : null}
    </>
  );
}
