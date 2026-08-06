import { Upload, X } from "lucide-react";

import { Button, Popover, PopoverContent, PopoverTrigger, Progress } from "@/ui";
import type { LibraryUploadJob } from "@/models/types/features/spaces/useSpaceLibraryData";

/**
 * Upload activity lives in the toolbar rather than a banner above the grid.
 *
 * Uploads run in the background, so the surface that reports them must not push
 * the Library content around or need dismissing. The tray only appears while
 * there is something to report.
 */
export function SpaceLibraryUploadTray({
  jobs,
  onClear,
}: {
  jobs: LibraryUploadJob[];
  onClear: () => void;
}) {
  if (jobs.length === 0) return null;

  const active = jobs.filter((job) => job.stage !== "ready" && job.stage !== "failed");
  const failed = jobs.filter((job) => job.stage === "failed");
  const uploading = active.length > 0;
  // Average across the whole batch so the summary reflects the queue rather
  // than whichever file happens to be in flight.
  const overall = Math.round(
    (jobs.reduce((total, job) => total + job.progress, 0) / jobs.length) * 100,
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className="relative shrink-0"
          size="icon"
          variant="outline"
          type="button"
          aria-label={
            uploading
              ? `${active.length} upload${active.length === 1 ? "" : "s"} in progress`
              : `${jobs.length} upload${jobs.length === 1 ? "" : "s"} finished`
          }
        >
          <Upload className={uploading ? "animate-pulse" : ""} size={15} aria-hidden="true" />
          <span
            className={`absolute -right-1 -top-1 grid size-4 place-items-center rounded-full text-[9px] font-semibold text-cream-bright ${
              failed.length > 0 ? "bg-charcoal-active" : "bg-charcoal-active"
            }`}
          >
            {failed.length > 0 ? failed.length : active.length || jobs.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="m-0 text-xs font-medium">
            {uploading
              ? `Uploading ${active.length} of ${jobs.length}`
              : failed.length > 0
                ? `${jobs.length - failed.length} uploaded, ${failed.length} failed`
                : `${jobs.length} upload${jobs.length === 1 ? "" : "s"} complete`}
          </p>
          {!uploading ? (
            <Button
              size="icon"
              variant="ghost"
              type="button"
              onClick={onClear}
              aria-label="Clear finished uploads"
            >
              <X size={13} />
            </Button>
          ) : null}
        </div>
        {uploading ? <Progress className="h-0.5 rounded-none" value={overall} /> : null}
        <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
          {jobs.map((job) => (
            <li className="border-b px-3 py-2 last:border-b-0" key={job.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-xs">{job.name}</span>
                <span className="shrink-0 text-[10px] text-cream-muted">
                  {job.stage === "failed"
                    ? "Failed"
                    : job.stage === "ready"
                      ? "Done"
                      : `${Math.round(job.progress * 100)}%`}
                </span>
              </div>
              {job.stage === "failed" && job.error ? (
                <p className="m-0 mt-0.5 truncate text-[10px] text-cream-bright">{job.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
