import { SystemErrorNotice } from "@/features/support/systemErrors";
import { Badge, Progress } from "@/shared/ui";
import { JobIcon, stageLabel, type AddToSpaceJob } from "./AddFilesJobStatus";

/** The files an Add to Space upload copies, with overall and per-file progress. */
export function AddFilesJobList({
  jobs,
  progress,
  showPercent,
}: {
  jobs: AddToSpaceJob[];
  /** Overall progress, 0–100. */
  progress: number;
  showPercent: boolean;
}) {
  return (
    <section className="grid min-h-0 gap-2" aria-label="Files to copy">
      <div className="flex items-center justify-between gap-3 text-xs text-cream-muted">
        <span>
          {jobs.length} {jobs.length === 1 ? "file" : "files"}
        </span>
        {showPercent ? <span>{Math.round(progress)}%</span> : null}
      </div>
      <Progress value={progress} aria-label="Overall upload progress" />
      <div className="misty-transient-scrollbar grid max-h-64 gap-1.5 overflow-y-auto pr-1">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-charcoal-card px-2.5 py-2"
          >
            <JobIcon stage={job.stage} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium" title={job.path}>
                {job.name}
              </span>
              <span className="block truncate text-[10px] text-cream-muted">
                {stageLabel(job.stage)}
              </span>
              {job.error ? (
                <SystemErrorNotice
                  error={job.error}
                  scope={`library:add-files:${job.id}`}
                  title={`${job.name} could not be added to the Space`}
                />
              ) : null}
            </span>
            {job.stage === "ready" ? <Badge variant="outline">Added</Badge> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
