import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Skeleton } from "@/shared/ui";
import { projectGitDiff } from "../../store/useAgentsStore";
import { DiffCounts, DiffView } from "./DiffView";
import type { DiffSet } from "./diffTypes";
import { ProjectRuns } from "./ProjectRuns";
import { plainFailure } from "./undoText";

/**
 * One project's uncommitted changes, from git: what the coding tool changed
 * since the last commit, file by file, and the coding runs that can still be
 * undone. Committing and pushing happen in the person's coding tool, which
 * asks before pushing.
 */
export function ProjectReview({ scopeId, name }: { scopeId: string; name: string }) {
  const [diff, setDiff] = useState<DiffSet>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDiff(await projectGitDiff(scopeId));
    } catch (problem) {
      setError(plainFailure(problem, "Misty couldn’t read this project’s changes."));
    } finally {
      setLoading(false);
    }
  }, [scopeId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="misty-project-review flex min-h-0 flex-1 flex-col">
      <header className="misty-changes-header px-4 py-3">
        <strong>{name}</strong>
        {diff ? <DiffCounts additions={diff.additions} deletions={diff.deletions} /> : null}
        <span className="misty-changes-actions">
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </Button>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {error ? (
          <p role="alert" className="misty-diff-note">
            {error}
          </p>
        ) : diff === undefined ? (
          <div className="grid gap-2" aria-hidden="true">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : diff.files.length ? (
          <DiffView set={diff} />
        ) : (
          <p className="misty-diff-note">No uncommitted changes.</p>
        )}
        <ProjectRuns scopeId={scopeId} name={name} onChanged={() => void load()} />
      </div>
    </div>
  );
}
