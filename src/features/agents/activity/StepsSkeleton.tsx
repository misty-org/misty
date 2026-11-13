import { Skeleton } from "@/shared/ui";

const sentenceWidths = ["w-3/5", "w-1/2", "w-2/3", "w-2/5", "w-1/2"];

/** One run's steps before they are first read: rows shaped like its step rows, icon, sentence and
 * time into the run. */
export function StepRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Steps" aria-busy="true" className="grid">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-7.5 items-center gap-2 px-2.5 py-1">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <div className="min-w-0 flex-1">
            <Skeleton
              className={`h-3 rounded-sm ${sentenceWidths[index % sentenceWidths.length]}`}
            />
          </div>
          <Skeleton className="h-3 w-6 shrink-0 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

/** The Steps panel before this chat's runs are first read: the latest run's head (when it started
 * and its state), then its step rows. */
export function StepsSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-2 pb-3">
      <div className="grid gap-1 pt-2">
        <div className="flex min-h-7.5 items-center gap-2 px-2.5">
          <div className="flex-1">
            <Skeleton className="h-3 w-24 rounded-sm" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0 rounded-sm" />
        </div>
        <StepRowsSkeleton />
      </div>
    </div>
  );
}
