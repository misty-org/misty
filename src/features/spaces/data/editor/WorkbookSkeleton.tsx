import { Skeleton, SkeletonControl, Surface } from "@misty/ui";

/** The workbook page standing in while its record loads: its bar, the formula row and a grid. */
export function WorkbookSkeleton(props: { label: string }) {
  return (
    <Surface
      tone="page"
      role="status"
      aria-label={props.label}
      aria-busy="true"
      className="flex h-full min-h-0 flex-col"
    >
      <span className="sr-only">{props.label}</span>
      <div
        aria-hidden
        className="flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 pl-1 pr-3"
      >
        <SkeletonControl kind="icon" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <div aria-hidden className="flex h-8 shrink-0 items-center gap-3 border-b px-3">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div aria-hidden className="grid min-h-0 flex-1 content-start gap-3 overflow-hidden p-4">
        {Array.from({ length: 10 }, (_, row) => (
          <div key={row} className="grid grid-cols-6 gap-3">
            {Array.from({ length: 6 }, (_, col) => (
              <Skeleton key={col} className="h-3" />
            ))}
          </div>
        ))}
      </div>
    </Surface>
  );
}
