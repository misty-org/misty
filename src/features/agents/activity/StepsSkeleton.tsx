import { Skeleton } from "@misty/ui";

const sentenceWidths = ["w-3/5", "w-1/2", "w-2/3", "w-2/5", "w-1/2"];

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
